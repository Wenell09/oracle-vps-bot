import { db } from "../../config/database.js";


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
    `SELECT * FROM provisioning_jobs WHERE retry_token = $1`,
    [data.retryToken]
  );

  return {
    job: existing.rows[0] ?? null,
    created: false,
  };
}

export async function findProvisioningJobById(id) {
  const result = await db.query(
    `SELECT * FROM provisioning_jobs WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function findActiveProvisioningJob(telegramUserId) {
  const result = await db.query(
    `
      SELECT *
      FROM provisioning_jobs
      WHERE telegram_user_id = $1
        AND status IN ('PENDING', 'RETRYING')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [telegramUserId]
  );

  return result.rows[0] ?? null;
}

export async function claimDueProvisioningJobs(workerId, limit = 5) {
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
      locked_until = NOW() + INTERVAL '2 minutes',
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

export async function scheduleProvisioningRetry(
  id,
  {
    nextRetryAt,
    errorCode,
    errorMessage,
  }
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
    RETURNING *
  `;

  const result = await db.query(query, [
    id,
    nextRetryAt,
    errorCode,
    errorMessage,
  ]);

  return result.rows[0] ?? null;
}

export async function markProvisioningSucceeded(
  id,
  {
    instanceId,
    instanceState,
  }
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
    RETURNING *
  `;

  const result = await db.query(query, [
    id,
    instanceId,
    instanceState,
  ]);

  return result.rows[0] ?? null;
}

export async function markProvisioningFailed(
  id,
  {
    errorCode,
    errorMessage,
  }
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
    RETURNING *
  `;

  const result = await db.query(query, [
    id,
    errorCode,
    errorMessage,
  ]);

  return result.rows[0] ?? null;
}

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
    RETURNING *
  `;

  const result = await db.query(query, [
    id,
    telegramUserId,
  ]);

  return result.rows[0] ?? null;
}