# Oracle Cloud VPS Telegram Bot (Production Ready)

Bot Telegram berbasis Node.js untuk provisioning dan manajemen Virtual Private Server (VPS) pada Oracle Cloud Infrastructure (OCI). Bot ini dirancang dengan arsitektur serverless di Vercel, menggunakan PostgreSQL (Neon) sebagai distributed job state store, OCI SDK untuk komputasi cloud, dan Vercel Cron untuk penjadwalan antrean provisioning background dengan rekonsiliasi dan idempotensi tingkat enterprise.

---

## Daftar Isi

1. [Fitur Utama](#fitur-utama)
2. [Arsitektur Sistem](#arsitektur-sistem)
3. [Teknologi yang Digunakan](#teknologi-yang-digunakan)
4. [Alur Siklus Hidup Provisioning (Lifecycle)](#alur-siklus-hidup-provisioning-lifecycle)
5. [Instalasi & Persiapan Lokal](#instalasi--persiapan-lokal)
6. [Konfigurasi Environment Variables](#konfigurasi-environment-variables)
7. [Setup Database & Migrasi](#setup-database--migrasi)
8. [Setup Konfigurasi OCI](#setup-konfigurasi-oci)
9. [Konfigurasi Webhook Telegram](#konfigurasi-webhook-telegram)
10. [Arsitektur Worker & Vercel Cron](#arsitektur-worker--vercel-cron)
11. [Mekanisme Retry & Backoff](#mekanisme-retry--backoff)
12. [Daftar Perintah Bot](#daftar-perintah-bot)
13. [Pengujian Otomatis (Automated Testing)](#pengujian-otomatis-automated-testing)
14. [Panduan Deployment Vercel](#panduan-deployment-vercel)
15. [Monitoring & Recovery](#monitoring--recovery)
16. [Troubleshooting](#troubleshooting)

---

## 1. Fitur Utama

- **Provisioning Otomatis OCI:** Pembuatan VM OCI (khususnya shape Always Free `VM.Standard.A1.Flex` berbasis ARM Ampere).
- **Rekonsiliasi OCI & Idempotensi Ganda:**
  - Database level: Idempotency token (`retry_token`), locking atomik dengan `FOR UPDATE SKIP LOCKED`.
  - OCI level: Penggunaan `opcRetryToken` unik per job serta pencarian tag `freeformTags.provisioningJobId` sebelum peluncuran untuk mencegah duplikasi VPS.
- **Siklus Hidup Terdistribusi:** Penanganan status `PENDING` -> `PROCESSING` -> `RETRYING` -> `SUCCEEDED` / `FAILED` / `CANCELLED`.
- **Penjadwalan Otomatis Vercel Cron:** Eksekusi worker berkala secara aman melalui endpoint `/api/cron` yang memanggil `/api/worker` via HTTP `POST` dengan otorisasi Bearer token.
- **Deduplikasi Webhook Telegram:** Penyaringan `update_id` Telegram agar retry webhook tidak memicu duplikasi job.
- **Notifikasi Idempoten:** Notifikasi keberhasilan dan kegagalan dikirim secara atomik (`notified_at`) langsung ke chat Telegram pengguna.
- **Manajemen VPS Interaktif:** Cek status real-time, Start, Stop, Restart, dan Terminate instance dengan konfirmasi interaktif.
- **Klasifikasi Error Cerdas:** Membedakan error sementara (`OutOfHostCapacity`, `503`, timeouts) yang perlu di-retry secara otomatis dari error permanen (`401`, `403`, `QuotaExceeded`, `400`).

---

## 2. Arsitektur Sistem

```
+---------------------------------------------------------------------------------+
|                                USER (TELEGRAM)                                  |
+---------------------------------------------------------------------------------+
                                         |
                       Webhook HTTPS     v
+---------------------------------------------------------------------------------+
|                                VERCEL SERVERLESS                                |
|                                                                                 |
|  +--------------------+         +--------------------+                          |
|  |    /api/bot.js     |         |    /api/cron.js    | (Triggered by Vercel     |
|  |  (Telegram Updates)|         |  (Vercel Cron GET) |  Cron Scheduler)         |
|  +--------------------+         +--------------------+                          |
|            |                               |                                    |
|            v                               v HTTP POST (Bearer WORKER_SECRET)   |
|   [Update Deduplication]        +--------------------+                          |
|   [Auth & Validation]           |   /api/worker.js   |                          |
|            |                    |  (Job Processor)   |                          |
|            v                    +--------------------+                          |
|   [Enqueue Job PENDING]                    |                                    |
+--------------------------------------------|------------------------------------+
                     |                       |
                     v                       v
+---------------------------------------------------------------------------------+
|                           DATABASE (POSTGRESQL / NEON)                          |
|                                                                                 |
|  - provisioning_jobs (State store, worker locks, timestamps, instance OCIDs)    |
|  - telegram_processed_updates (Webhook deduplication)                           |
|  - schema_migrations (Sequential migration history)                             |
+---------------------------------------------------------------------------------+
                                             |
                   Reconciliation / Launch   v
+---------------------------------------------------------------------------------+
|                       ORACLE CLOUD INFRASTRUCTURE (OCI)                         |
|                                                                                 |
|  - ComputeClient (listInstances by tag, launchInstance with opcRetryToken)      |
|  - VirtualNetworkClient (listVnicAttachments, getVnic for Public IP)            |
|  - IdentityClient / LimitsClient (Availability domains, quota limits)           |
+---------------------------------------------------------------------------------+
```

---

## 3. Teknologi yang Digunakan

- **Runtime:** Node.js v20+ / v24 (ES Modules)
- **Framework Bot:** `grammy` v1.36+
- **Cloud SDK:** `oci-sdk` v2.147+
- **Database Driver:** `pg` (node-postgres) v8.23+ dengan support SSL/Neon
- **Platform Deployment:** Vercel Serverless Functions & Vercel Cron
- **Test Runner:** Node.js native test runner (`node:test`, `node:assert`)

---

## 4. Alur Siklus Hidup Provisioning (Lifecycle)

```
        +---------------+
        |    PENDING    |  <-- Permintaan diterima & disimpan ke database
        +---------------+
                |
                v
        +---------------+
+-----> |  PROCESSING   |  <-- Di-claim worker (locked_by, locked_until 10 menit)
|       +---------------+
|          |    |     |
|          |    |     +-------------------------+
|          |    |                               |
|          |    v Sukses                        v Error Transient
|          |  +---------------+               +---------------+
|          |  |   SUCCEEDED   |               |   RETRYING    |
|          |  +---------------+               +---------------+
|          |  (Terminal / Notified)                   |
|          |                                          | next_retry_at due
|          | Error Permanen / Max Attempts            v
|          +----------------------------------> +---------------+
|                                               |  (Claim Ulang)|
|                                               +---------------+
v Gagal Permanen
+---------------+
|    FAILED     |  (Terminal / Notified)
+---------------+
```

---

## 5. Instalasi & Persiapan Lokal

### Prasyarat
- Node.js versi 20 ke atas.
- Akun Oracle Cloud Infrastructure (OCI) dengan akses API Key.
- Bot Telegram dari [@BotFather](https://t.me/BotFather).
- Database PostgreSQL (misal Neon Console atau PostgreSQL lokal).

### Langkah Instalasi
```bash
# Clone repository
git clone <repository_url>
cd oracle-vps-bot

# Install dependensi
npm install

# Buat file konfigurasi environment
cp .env.example .env.local
```

---

## 6. Konfigurasi Environment Variables

Isi `.env.local` (atau `.env` di production):

| Variabel | Keterangan | Wajib? |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram dari BotFather | Ya |
| `TELEGRAM_WEBHOOK_SECRET` | Secret token validasi webhook Telegram | Ya |
| `ALLOWED_TELEGRAM_USER_ID` | Telegram User ID admin yang diizinkan mengakses bot | Ya |
| `TELEGRAM_ADMIN_ID` | ID admin (biasanya sama dengan `ALLOWED_TELEGRAM_USER_ID`) | Ya |
| `APP_URL` | Base URL deployment (misal `https://vps-bot.vercel.app`) | Ya |
| `OCI_TENANCY_OCID` | Tenancy OCID dari profil OCI | Ya |
| `OCI_USER_OCID` | User OCID yang memiliki API Key | Ya |
| `OCI_COMPARTMENT_OCID` | Compartment OCID target VPS | Ya |
| `OCI_FINGERPRINT` | Fingerprint API Key | Ya |
| `OCI_REGION` | Region OCI (misal `ap-batam-1`) | Ya |
| `OCI_PRIVATE_KEY` | Private Key RSA (format PEM dengan `\n`) | Ya |
| `OCI_AVAILABILITY_DOMAIN` | Availability Domain (misal `UXXx:AP-BATAM-1-AD-1`) | Ya |
| `OCI_IMAGE_OCID` | OCID dari Ubuntu OS Image | Ya |
| `OCI_VCN_OCID` | Virtual Cloud Network OCID | Ya |
| `OCI_SUBNET_OCID` | Subnet OCID tempat instance ditempatkan | Ya |
| `OCI_SSH_PUBLIC_KEY` | Public key SSH (format `ssh-ed25519` / `ssh-rsa`) | Ya |
| `DATABASE_URL` | PostgreSQL connection string | Ya |
| `WORKER_SECRET` | Secret acak untuk proteksi endpoint worker | Ya |
| `CRON_SECRET` | Secret token untuk otorisasi Vercel Cron | Ya |

---

## 7. Setup Database & Migrasi

Jalankan script migrasi otomatis:
```bash
npm run db:migrate
```

Script migrasi akan membaca dan mengeksekusi file SQL di direktori `src/database/migrations/` secara berurutan:
1. `001_create_provisioning_jobs.sql`: Membuat tabel utama `provisioning_jobs` beserta index awal.
2. `002_add_processing_status_and_updates.sql`: Menambahkan status `PROCESSING`, kolom `notified_at`, kolom `public_ip`, tabel `telegram_processed_updates`, dan composite index untuk worker claim.

---

## 8. Setup Konfigurasi OCI

1. Buat API Key di OCI Console:
   - Buka **Profile** -> **API Keys** -> **Add API Key**.
   - Unduh Private Key dan catat Fingerprint.
2. Tambahkan Policy OCI pada Compartment target jika belum ada:
   ```
   Allow group Administrators to manage instance-family in compartment <compartment_name>
   Allow group Administrators to manage virtual-network-family in compartment <compartment_name>
   ```
3. Uji koneksi OCI melalui CLI:
   ```bash
   npm run oci:test
   ```

---

## 9. Konfigurasi Webhook Telegram

Setelah aplikasi di-deploy ke Vercel atau URL publik aktif:

```bash
# Set webhook Telegram ke Vercel
npm run webhook:set

# Hapus webhook jika ingin menggunakan polling lokal
npm run webhook:delete
```

---

## 10. Arsitektur Worker & External Cron Scheduler (cron-job.org)

### Mengapa Menggunakan External Scheduler?
Pada paket **Vercel Hobby (Gratis)**, fitur Vercel Cron dibatasi maksimal **1 kali eksekusi per hari**. Padahal proses provisioning OCI Always Free membutuhkan pengecekan dan retry antrean berkala (misal setiap 5 menit).

Oleh karena itu, dependency Vercel Cron dihapus dari `vercel.json` dan digantikan dengan dedicated endpoint untuk external cron:
```
GET https://oracle-vps-bot.vercel.app/api/cron/worker
```

### Konfigurasi di cron-job.org (Gratis & Mudah)
1. Daftar atau login di [cron-job.org](https://cron-job.org).
2. Klik **Create Cronjob**.
3. Atur parameter berikut:
   - **Title:** `Oracle VPS Worker Scheduler`
   - **URL:** `https://<your-app-domain>.vercel.app/api/cron/worker` (sesuaikan dengan domain Vercel kamu)
   - **Execution Schedule:** Every 5 minutes (`*/5 * * * *`)
   - **HTTP Method:** `GET`
4. Buka tab **Advanced** > **Headers**:
   - Tambahkan request header:
     - **Key:** `Authorization`
     - **Value:** `Bearer <CRON_SECRET>` (sesuaikan dengan nilai `CRON_SECRET` di Vercel Environment Variables)
5. Simpan (Save). Cron-job.org akan secara otomatis memicu antrean worker setiap 5 menit.

### Eksekusi & Keamanan Endpoint `/api/cron/worker`
1. Endpoint menerima HTTP `GET` dari scheduler eksternal dengan header `Authorization: Bearer <CRON_SECRET>`.
2. Menolak request jika secret dikirim di URL query parameters (`?secret=...`).
3. Memanggil `/api/worker` via HTTP `POST` internal dengan header `Authorization: Bearer <WORKER_SECRET>`.
4. Memiliki fallback eksekusi in-process jika container serverless memblokir network loopback internal.
5. Menjaga otentikasi internal worker (`WORKER_SECRET`) tetap terisolasi dan tidak terekspos ke publik.
6. Worker mengeksekusi:
   - `failExhaustedProvisioningJobs()`: Menandai job yang attempt-nya habis dan lock-nya expired sebagai `FAILED`.
   - `claimDueProvisioningJobs()`: Mengunci 1 job yang jatuh tempo menggunakan `FOR UPDATE SKIP LOCKED`.
   - Rekonsiliasi OCI: Memeriksa apakah instance sudah pernah dibuat sebelumnya melalui tag `freeformTags.provisioningJobId`.
   - Launching OCI: Meluncurkan instance menggunakan `retry_token` jika belum ada.
   - Persistence & Notifikasi: Menandai `SUCCEEDED` dan mengirim rincian VPS ke pengguna secara idempoten.

---

## 11. Mekanisme Retry & Backoff

- **Jadwal Exponential Backoff:** 1 menit, 3 menit, 5 menit, 10 menit, 15 menit (maksimal 20 percobaan).
- **Jitter:** Menambahkan jitter acak (0-30 detik) untuk mencegah tabrakan permintaan serentak (thundering herd).
- **Error Transient yang di-retry:**
  - `OutOfHostCapacity` (kapasitas host OCI penuh).
  - HTTP `503 Service Unavailable`, `502 Bad Gateway`, `504 Gateway Timeout`.
  - HTTP `429 Too Many Requests`.
  - Network timeouts (`ETIMEDOUT`, `ECONNRESET`, `ECONNABORTED`).
- **Error Permanen yang langsung dihentikan (FAILED):**
  - `401 Not Authenticated` / Kredensial tidak valid.
  - `403 Not Authorized` / Permission denied.
  - `QuotaExceeded` / Kuota compute akun OCI habis.
  - `400 Invalid Parameter` / Konfigurasi subnet/image salah.
  - `409 Conflict` / Instance already exists.

---

## 12. Daftar Perintah Bot

| Perintah | Deskripsi |
|---|---|
| `/start` | Membuka menu selamat datang dan panduan bot |
| `/help` | Menampilkan seluruh daftar perintah yang tersedia |
| `/create` | Meluncurkan panduan pembuatan VPS baru (dengan konfirmasi) |
| `/status` | Menampilkan status real-time VPS aktif (dengan tombol Stop/Restart/Terminate) |
| `/list` | Menampilkan seluruh instance VPS milik akun pengguna |
| `/delete` | Membuka menu terminasi/penghapusan VPS secara aman |
| `/retry_status` | Memeriksa progres job antrean provisioning terakhir |
| `/retry_list` | Menampilkan daftar seluruh job yang sedang dalam status antre/retry |
| `/cancel_retry` | Membatalkan antrean job provisioning yang belum dieksekusi worker |
| `/oci_test` | Menguji konektivitas dan autentikasi ke Oracle Cloud |
| `/list_shapes` | Menampilkan daftar VM shapes yang tersedia di compartment |
| `/list_images` | Menampilkan daftar OS images yang didukung |
| `/network_check` | Melakukan audit kesiapan VCN, Subnet, Route Table, dan Security List |
| `/quota_check` | Memeriksa limit kuota CPU dan RAM OCI |
| `/ping` | Memeriksa uptime dan respons bot |
| `/id` | Menampilkan Telegram User ID dan Chat ID |

---

## 13. Pengujian Otomatis (Automated Testing)

Project ini dilengkapi dengan test suite lengkap (49 tests) menggunakan Node.js native test runner:

```bash
# Menjalankan seluruh test suite
NODE_ENV=test npm test
```

### Lingkup Test:
- **Unit Tests:** Klasifikasi error OCI, sanitasi secret, validasi backoff & jitter, validasi konfigurasi environment & format public key SSH.
- **Repository Tests:** Operasi atomik database, penjaminan locking `FOR UPDATE SKIP LOCKED`, idempotensi `retry_token`, transisi state, dan idempotensi notifikasi.
- **Worker 10 Scenarios:**
  1. No due jobs.
  2. Existing OCI instance found (reconciled tanpa launch ganda).
  3. No instance found and launch succeeds.
  4. Launch fails with OutOfHostCapacity (retry dijadwalkan).
  5. OCI reconciliation fails (proses dihentikan aman tanpa launch).
  6. Launch timeout ambiguous (diperlakukan sebagai retryable).
  7. Job lock expired (penolakan update state).
  8. Job diklaim worker lain (penolakan modifikasi).
  9. Maximum retry attempts reached (berpindah ke `FAILED`).
  10. Duplicate worker invocation (concurrency safe).
- **Telegram Tests:** Deduplikasi webhook `update_id`, notifikasi rich message, dan pencegahan notifikasi duplikat.
- **Cron Tests:** Validasi HTTP method, penolakan secret di URL query string, otorisasi `CRON_SECRET`, dan delegasi ke worker.

---

## 14. Panduan Deployment Vercel

### 1. Import Proyek ke Vercel
Hubungkan repository GitHub ke Vercel melalui dashboard Vercel.

### 2. Atur Environment Variables di Vercel
Tambahkan seluruh variabel yang tercantum di `.env.example` ke **Project Settings** > **Environment Variables** di Vercel.

### 3. Jalankan Migrasi Database
Pastikan database Neon atau PostgreSQL target sudah dimigrasikan:
```bash
npm run db:migrate
```

### 4. Daftarkan Webhook Telegram
Setelah deployment Vercel memiliki URL aktif (misal `https://your-bot.vercel.app`):
```bash
# Pastikan APP_URL di .env sudah disesuaikan, lalu jalankan:
npm run webhook:set
```

### 5. Verifikasi Cron & Worker
Uji endpoint worker melalui terminal:
```bash
curl -X POST https://your-bot.vercel.app/api/worker \
  -H "Authorization: Bearer YOUR_WORKER_SECRET"
```

---

## 15. Monitoring & Recovery

- **Structured Logging:** Seluruh aktivitas worker mencatat timestamp, `workerId`, `jobId`, `attempt_count`, `instanceId`, serta pesan error yang tersanitasi.
- **Stuck Jobs Recovery:** Job dengan status `PROCESSING` yang mengalami crash pada worker lama akan otomatis diambil kembali oleh worker berikutnya begitu `locked_until` (10 menit) terlampaui.
- **Notification Recovery:** Worker secara otomatis mencari job `SUCCEEDED` yang memiliki `notified_at IS NULL` dan mengirimkan notifikasi tertunda kepada pengguna.
- **Ambiguous Result Recovery:** Jika OCI API mengalami timeout saat peluncuran instance, worker pada giliran retry berikutnya akan memanggil `findInstanceByProvisioningJobId()` terlebih dahulu. Jika instance sebenarnya sempat terbuat oleh OCI, worker akan langsung merekonsiliasikannya tanpa meluncurkan instance ganda.

---

## 16. Troubleshooting

1. **Bot tidak merespons update:**
   - Periksa log di Vercel Functions (`api/bot.js`).
   - Pastikan `TELEGRAM_WEBHOOK_SECRET` di Vercel sama persis dengan yang didaftarkan via `scripts/set-webhook.js`.
   - Pastikan `ALLOWED_TELEGRAM_USER_ID` sesuai dengan ID Telegram kamu (cek via `/id`).
2. **Error `OutOfHostCapacity`:**
   - Ini adalah perilaku normal di OCI Always Free saat kapasitas ARM di region tersebut sedang penuh.
   - Biarkan worker dan cron berjalan; bot akan mencoba kembali secara otomatis dengan interval bertahap (1m, 3m, 5m, 10m, 15m) hingga kapasitas tersedia.
3. **Instance terbuat di OCI tetapi status bot tidak update:**
   - Worker akan merekonsiliasikan instance tersebut secara otomatis pada eksekusi berikutnya dan memperbarui database.
   - Kamu juga dapat menjalankan perintah `/status` di Telegram untuk memaksa sinkronisasi real-time dengan OCI.
