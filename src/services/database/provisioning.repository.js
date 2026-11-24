import { db } from "../../config/database.js";

export const WORKER_LOCK_MINUTES = 10;

/**
 * Memulai percobaan provisioning pertama dari bot interaction.
 *
 * Job berstatus PENDING dengan attempt_count = 0 berpindah ke PROCESSING.
 */
export async function startInitialProvisioningAttempt(id) {
    const query = `
        UPDATE provisioning_jobs
        SET
            status = 'PROCESSING',
            attempt_count = attempt_count + 1,
            last_attempt_at = NOW(),
            locked_until = NOW() + ($2 * INTERVAL '1 minute'),
            updated_at = NOW()
        WHERE id = $1
            AND status = 'PENDING'
            AND attempt_count = 0
            AND locked_by IS NULL
        RETURNING *
    `;

    const result = await db.query(query, [id, WORKER_LOCK_MINUTES]);
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
        LIMIT 1
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
 * Mengambil provisioning job berdasarkan OCI instance ID.
 */
export async function findProvisioningJobByInstanceId(instanceId) {
    const query = `
        SELECT *
        FROM provisioning_jobs
        WHERE instance_id = $1
        ORDER BY created_at DESC
        LIMIT 1
    `;

    const result = await db.query(query, [instanceId]);
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
            AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
        ORDER BY created_at DESC
        LIMIT 1
    `;

    const result = await db.query(query, [telegramUserId]);
    return result.rows[0] ?? null;
}

/**
 * Mengambil job terbaru milik user, termasuk job yang sudah selesai.
 */
export async function findLatestProvisioningJob(telegramUserId) {
    const query = `
        SELECT
            id,
            display_name,
            shape,
            status,
            attempt_count,
            max_attempts,
            next_retry_at,
            last_attempt_at,
            error_code,
            error_message,
            instance_id,
            instance_state,
            public_ip,
            created_at,
            updated_at,
            completed_at
        FROM provisioning_jobs
        WHERE telegram_user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
    `;

    const result = await db.query(query, [telegramUserId]);
    return result.rows[0] ?? null;
}

export async function listProvisioningJobsByUser(telegramUserId, limit = 20) {
    const query = `
        SELECT *
        FROM provisioning_jobs
        WHERE telegram_user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
    `;

    const result = await db.query(query, [telegramUserId, limit]);
    return result.rows;
}

/**
 * Mengambil job retry yang sudah waktunya diproses atau job pending/stuck.
 *
 * FOR UPDATE SKIP LOCKED mencegah beberapa worker
 * mengambil job yang sama secara bersamaan.
 *
 * Job dikunci selama WORKER_LOCK_MINUTES dan status diset ke PROCESSING.
 */
export async function claimDueProvisioningJobs(workerId, limit = 1) {
    if (!workerId) {
        throw new Error("Worker ID wajib diisi.");
    }

    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("Worker limit harus berupa integer positif.");
    }

    const query = `
        WITH selected_jobs AS (
            SELECT id
            FROM provisioning_jobs
            WHERE (
                -- RETRYING job yang sudah jatuh tempo
                (status = 'RETRYING' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
                -- PENDING job yang belum diambil worker
                OR (status = 'PENDING' AND (locked_until IS NULL OR locked_until < NOW()))
                -- PROCESSING job yang lock-nya expired (stuck job recovery)
                OR (status = 'PROCESSING' AND (locked_until IS NULL OR locked_until < NOW()))
            )
            AND (
                locked_until IS NULL
                OR locked_until < NOW()
            )
            AND attempt_count < max_attempts
            ORDER BY
                CASE WHEN status = 'RETRYING' THEN 1 ELSE 0 END ASC,
                next_retry_at ASC NULLS FIRST,
                created_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
        )
        UPDATE provisioning_jobs AS jobs
        SET
            status = 'PROCESSING',
            locked_by = $1,
            locked_until = NOW() + ($3 * INTERVAL '1 minute'),
            attempt_count = jobs.attempt_count + 1,
            last_attempt_at = NOW(),
            updated_at = NOW()
        FROM selected_jobs
        WHERE jobs.id = selected_jobs.id
        RETURNING jobs.*
    `;

    const result = await db.query(query, [
        workerId,
        limit,
        WORKER_LOCK_MINUTES,
    ]);

    return result.rows;
}

/**
 * Menandai job RETRYING atau PROCESSING yang sudah mencapai batas percobaan
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
        WHERE status IN ('RETRYING', 'PROCESSING')
            AND attempt_count >= max_attempts
            AND (
                locked_until IS NULL
                OR locked_until < NOW()
            )
        RETURNING id, telegram_user_id, telegram_chat_id, display_name
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
            AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
            AND (
                (
                    $5::VARCHAR IS NULL
                    AND (locked_by IS NULL OR locked_until <= NOW())
                )
                OR (
                    $5::VARCHAR IS NOT NULL
                    AND locked_by = $5
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
        publicIp = null,
    },
    workerId = null
) {
    const query = `
        UPDATE provisioning_jobs
        SET
            status = 'SUCCEEDED',
            instance_id = $2,
            instance_state = $3,
            public_ip = COALESCE($5, public_ip),
            next_retry_at = NULL,
            error_code = NULL,
            error_message = NULL,
            locked_by = NULL,
            locked_until = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
            AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
            AND (
                (
                    $4::VARCHAR IS NULL
                    AND (locked_by IS NULL OR locked_until <= NOW())
                )
                OR (
                    $4::VARCHAR IS NOT NULL
                    AND locked_by = $4
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
        publicIp,
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
            AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
            AND (
                (
                    $4::VARCHAR IS NULL
                    AND (locked_by IS NULL OR locked_until <= NOW())
                )
                OR (
                    $4::VARCHAR IS NOT NULL
                    AND locked_by = $4
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
            AND (locked_by IS NULL OR locked_until < NOW())
        RETURNING *
    `;

    const result = await db.query(query, [
        id,
        telegramUserId,
    ]);

    return result.rows[0] ?? null;
}

/**
 * Tandai bahwa notifikasi Telegram sudah dikirim ke user secara idempoten.
 */
export async function markJobNotified(id) {
    const query = `
        UPDATE provisioning_jobs
        SET
            notified_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
            AND notified_at IS NULL
        RETURNING *
    `;

    const result = await db.query(query, [id]);
    return result.rows[0] ?? null;
}

/**
 * Cari job sukses yang belum dikirimi notifikasi (recovery).
 */
export async function findUnnotifiedSucceededJobs(limit = 10) {
    const query = `
        SELECT *
        FROM provisioning_jobs
        WHERE status = 'SUCCEEDED'
            AND notified_at IS NULL
        ORDER BY completed_at ASC
        LIMIT $1
    `;

    const result = await db.query(query, [limit]);
    return result.rows;
}

/**
 * Perbarui instance state dan public IP dari OCI sync.
 */
export async function updateInstanceState(instanceId, { instanceState, publicIp = null }) {
    const query = `
        UPDATE provisioning_jobs
        SET
            instance_state = $2,
            public_ip = COALESCE($3, public_ip),
            updated_at = NOW()
        WHERE instance_id = $1
        RETURNING *
    `;

    const result = await db.query(query, [instanceId, instanceState, publicIp]);
    return result.rows[0] ?? null;
}

/**
 * Catat update Telegram untuk deduplikasi webhook.
 * Returns true jika update baru, false jika duplicate.
 */
export async function recordTelegramUpdate(updateId) {
    const query = `
        INSERT INTO telegram_processed_updates (update_id)
        VALUES ($1)
        ON CONFLICT (update_id) DO NOTHING
        RETURNING update_id
    `;

    try {
        const result = await db.query(query, [updateId]);
        return Boolean(result.rows[0]);
    } catch (error) {
        // Jika tabel belum ada atau DB issue, fallback gracefully agar tidak memblokir bot
        console.error("[DATABASE] Error recording telegram update:", error.message);
        return true;
    }
}
