
import { db } from "../../config/database.js";

/**
 * Mengambil job provisioning aktif milik user.
 */
export async function listActiveProvisioningJobs(telegramUserId, limit = 10) {
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
            created_at,
            updated_at
        FROM provisioning_jobs
        WHERE telegram_user_id = $1
            AND status IN ('PENDING', 'RETRYING')
        ORDER BY created_at DESC
        LIMIT $2
    `;

    const result = await db.query(query, [telegramUserId, limit]);

    return result.rows;
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

/**
 * Membatalkan job aktif yang belum di-claim worker.
 *
 * User hanya dapat membatalkan job miliknya.
 * Job yang sudah dikunci worker tidak dapat dibatalkan.
 */
export async function cancelRetryJobByUser(jobId, telegramUserId) {
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
        RETURNING
            id,
            display_name,
            status,
            attempt_count,
            max_attempts,
            updated_at
    `;

    const result = await db.query(query, [jobId, telegramUserId]);

    return result.rows[0] ?? null;
}
