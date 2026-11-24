export async function helpCommand(ctx) {
    const message = `
📖 *PANDUAN PERINTAH BOT:*

*Manajemen VPS:*
• /create - Mulai konfigurasi dan buat VPS baru
• /status - Lihat status real-time VPS aktif (Start/Stop/Restart)
• /list   - Tampilkan semua instance VPS milik kamu
• /delete - Hapus instance VPS (dengan konfirmasi keamanan)

*Diagnostik OCI:*
• /oci_test      - Uji koneksi & autentikasi OCI
• /list_vps      - Ambil daftar mentah instance OCI dari compartment
• /list_shapes   - Lihat daftar shapes compute
• /list_images   - Lihat daftar OS images
• /list_vcns     - Lihat Virtual Cloud Networks
• /list_subnets  - Lihat Subnets
• /network_check - Audit kesiapan network OCI (Gateway, Route, SSH)
• /quota_check   - Periksa limit kuota OCI

*Antrean & Retry:*
• /retry_status - Cek status job antrean provisioning
• /retry_list   - Lihat semua job yang sedang antre/retry
• /cancel_retry - Batalkan job yang belum dieksekusi worker

*Utilitas:*
• /start - Menu utama
• /ping  - Periksa ketersediaan bot
• /id    - Dapatkan ID Telegram kamu
`;

    await ctx.reply(message, { parse_mode: "Markdown" });
}
