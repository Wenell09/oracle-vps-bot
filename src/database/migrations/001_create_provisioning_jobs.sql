CREATE TABLE IF NOT EXISTS provisioning_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Telegram requester
    telegram_user_id BIGINT NOT NULL,
    telegram_chat_id BIGINT NOT NULL,

    -- Provisioning configuration
    display_name VARCHAR(100) NOT NULL,
    shape VARCHAR(100) NOT NULL,
    availability_domain VARCHAR(255) NOT NULL,
    config JSONB NOT NULL,

    -- OCI idempotency
    retry_token VARCHAR(255) NOT NULL UNIQUE,

    -- Provisioning state
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'RETRYING',
                'SUCCEEDED',
                'FAILED',
                'CANCELLED'
            )
        ),

    -- Retry management
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 20,
    next_retry_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,

    -- Worker locking
    locked_by VARCHAR(100),
    locked_until TIMESTAMPTZ,

    -- OCI result
    instance_id VARCHAR(255),
    instance_state VARCHAR(50),

    -- Error information
    error_code VARCHAR(100),
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Jobs ready for retry
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_retry
ON provisioning_jobs (next_retry_at)
WHERE status = 'RETRYING';

-- Find jobs by Telegram user
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_telegram_user
ON provisioning_jobs (telegram_user_id, created_at DESC);

-- Find active jobs
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_active
ON provisioning_jobs (status, created_at DESC)
WHERE status IN ('PENDING', 'RETRYING');