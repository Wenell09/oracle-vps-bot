
import { db } from "../../config/database.js";

/**
 * Memulai percobaan provisioning pertama.
 *
 * Hanya job berstatus PENDING dengan attempt_count = 0
 * yang dapat memulai provisioning.
 */
export async function startInitialProvisioningAttempt(id) {
  const query = `
        UPDATE provisioning_jobs
        SET
            attempt_count = attempt_count + 1,
            last_attempt_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
            AND status = 'PENDING'
            AND attempt_count = 0
        RETURNING *
    `;

  const result = await db.query(query, [id]);

  return result.rows[0] ?? null;
}

/**
 * Membuat provisioning job baru.
 *
 * retry_token digunakan sebagai idempotency key.
 */
export async function createProvisioningJob(data) {
  const query = `
        INSERT INTO provisioning_jobs (
            telegram_user_id,
            telegram_chat_id,
            display_name,
            shape,
            availability_domain,
            config,
            retry_token,
            status,
            max_attempts
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
        ON CONFLICT (retry_token) DO NOTHING
        RETURNING *
    `;

  const values = [
    data.telegramUserId,
    data.telegramChatId,
    data.displayName,
    data.shape,
    data.availabilityDomain,
    JSON.stringify(data.config),
    data.retryToken,
    data.maxAttempts ?? 20,
  ];

  const result = await db.query(query, values);

  if (result.rows[0]) {
    return {
      job: result.rows[0],
      created: true,
    };
  }

  const existing = await db.query(
    `
            SELECT *
            FROM provisioning_jobs
            WHERE retry_token = $1
        `,
    [data.retryToken]
  );

  return {
    job: existing.rows[0] ?? null,
    created: false,
  };
}

/**
 * Mengambil provisioning job berdasarkan ID.
 */
export async function findProvisioningJobById(id) {
  const query = `
        SELECT *
        FROM provisioning_jobs
        WHERE id = $1
        LIMIT 1
    `;

  const result = await db.query(query, [id]);

  return result.rows[0] ?? null;
}

/**
 * Mengambil provisioning job aktif milik Telegram user.
 */
export async function findActiveProvisioningJob(telegramUserId) {
  const query = `
        SELECT *
        FROM provisioning_jobs
        WHERE telegram_user_id = $1
            AND status IN ('PENDING', 'RETRYING')
        ORDER BY created_at DESC
        LIMIT 1
    `;

  const result = await db.query(query, [telegramUserId]);

  return result.rows[0] ?? null;
}

/**
 * Mengambil job retry yang sudah waktunya diproses.
 *
 * FOR UPDATE SKIP LOCKED mencegah beberapa worker
 * mengambil job yang sama secara bersamaan.
 *
 * Job akan dikunci selama 5 menit.
 */
export async function claimDueProvisioningJobs(workerId, limit = 1) {
  const query = `
        WITH selected_jobs AS (
            SELECT id
            FROM provisioning_jobs
            WHERE status = 'RETRYING'
                AND next_retry_at <= NOW()
                AND (
                    locked_until IS NULL
                    OR locked_until < NOW()
                )
                AND attempt_count < max_attempts
            ORDER BY next_retry_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
        )
        UPDATE provisioning_jobs AS jobs
        SET
            locked_by = $1,
            locked_until = NOW() + INTERVAL '5 minutes',
            attempt_count = jobs.attempt_count + 1,
            last_attempt_at = NOW(),
            updated_at = NOW()
        FROM selected_jobs
        WHERE jobs.id = selected_jobs.id
        RETURNING jobs.*
    `;

  const result = await db.query(query, [workerId, limit]);

  return result.rows;
}

/**
 * Menandai job RETRYING yang sudah mencapai batas percobaan
 * tetapi tidak lagi memiliki worker aktif sebagai FAILED.
 *
 * Mencegah job tertahan selamanya jika worker crash
 * setelah mengambil percobaan terakhir.
 */
export async function failExhaustedProvisioningJobs() {
  const query = `
        UPDATE provisioning_jobs
        SET
            status = 'FAILED',
            next_retry_at = NULL,
            error_code = 'MAX_ATTEMPTS_REACHED',
            error_message = 'Maximum attempts reached. Worker did not complete the provisioning attempt.',
            locked_by = NULL,
            locked_until = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE status = 'RETRYING'
            AND attempt_count >= max_attempts
            AND (
                locked_until IS NULL
                OR locked_until < NOW()
            )
        RETURNING id
    `;

  const result = await db.query(query);

  return result.rows;
}

/**
 * Menjadwalkan retry berikutnya.
 *
 * Jika dipanggil oleh worker, worker harus masih memiliki lock aktif.
 * Jika dipanggil oleh proses awal, locked_by harus NULL.
 */
export async function scheduleProvisioningRetry(
  id,
  {
    nextRetryAt,
    errorCode,
    errorMessage,
  },
  workerId = null
) {
  const query = `
        UPDATE provisioning_jobs
        SET
            status = 'RETRYING',
            next_retry_at = $2,
            error_code = $3,
            error_message = $4,
            locked_by = NULL,
            locked_until = NULL,
            updated_at = NOW()
        WHERE id = $1
            AND status IN ('PENDING', 'RETRYING')
            AND (
                ($5::VARCHAR IS NULL AND locked_by IS NULL)
                OR (
                    locked_by = $5
                    AND locked_until > NOW()
                )
            )
        RETURNING *
    `;

  const values = [
    id,
    nextRetryAt,
    errorCode,
    errorMessage,
    workerId,
  ];

  const result = await db.query(query, values);

  return result.rows[0] ?? null;
}

/**
 * Menandai provisioning berhasil.
 */
export async function markProvisioningSucceeded(
  id,
  {
    instanceId,
    instanceState,
  },
  workerId = null
) {
  const query = `
        UPDATE provisioning_jobs
        SET
            status = 'SUCCEEDED',
            instance_id = $2,
            instance_state = $3,
            next_retry_at = NULL,
            error_code = NULL,
            error_message = NULL,
            locked_by = NULL,
            locked_until = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
            AND status IN ('PENDING', 'RETRYING')
            AND (
                ($4::VARCHAR IS NULL AND locked_by IS NULL)
                OR (
                    locked_by = $4
                    AND locked_until > NOW()
                )
            )
        RETURNING *
    `;

  const values = [
    id,
    instanceId,
    instanceState,
    workerId,
  ];

  const result = await db.query(query, values);

  return result.rows[0] ?? null;
}

/**
 * Menandai provisioning gagal secara permanen.
 */
export async function markProvisioningFailed(
  id,
  {
    errorCode,
    errorMessage,
  },
  workerId = null
) {
  const query = `
        UPDATE provisioning_jobs
        SET
            status = 'FAILED',
            next_retry_at = NULL,
            error_code = $2,
            error_message = $3,
            locked_by = NULL,
            locked_until = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
            AND status IN ('PENDING', 'RETRYING')
            AND (
                ($4::VARCHAR IS NULL AND locked_by IS NULL)
                OR (
                    locked_by = $4
                    AND locked_until > NOW()
                )
            )
        RETURNING *
    `;

  const values = [
    id,
    errorCode,
    errorMessage,
    workerId,
  ];

  const result = await db.query(query, values);

  return result.rows[0] ?? null;
}

/**
 * Membatalkan provisioning job.
 *
 * Hanya job yang belum dikunci worker yang dapat dibatalkan.
 */
export async function cancelProvisioningJob(id, telegramUserId) {
  const query = `
        UPDATE provisioning_jobs
        SET
            status = 'CANCELLED',
            next_retry_at = NULL,
            locked_by = NULL,
            locked_until = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
            AND telegram_user_id = $2
            AND status IN ('PENDING', 'RETRYING')
            AND locked_by IS NULL
        RETURNING *
    `;

  const result = await db.query(query, [
    id,
    telegramUserId,
  ]);

  return result.rows[0] ?? null;
}
