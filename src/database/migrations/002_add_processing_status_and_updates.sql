-- Migration 002: Add PROCESSING status, notification tracking, and update deduplication

-- 1. Update status check constraint to include 'PROCESSING'
ALTER TABLE provisioning_jobs DROP CONSTRAINT IF EXISTS provisioning_jobs_status_check;
ALTER TABLE provisioning_jobs ADD CONSTRAINT provisioning_jobs_status_check
    CHECK (
        status IN (
            'PENDING',
            'PROCESSING',
            'RETRYING',
            'SUCCEEDED',
            'FAILED',
            'CANCELLED'
        )
    );

-- 2. Add notification tracking column for idempotent Telegram notifications
ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- 3. Add public IP cache column for quick lookup
ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS public_ip VARCHAR(50);

-- 4. Telegram update deduplication table
CREATE TABLE IF NOT EXISTS telegram_processed_updates (
    update_id BIGINT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleaning up old telegram updates
CREATE INDEX IF NOT EXISTS idx_telegram_processed_updates_time
ON telegram_processed_updates (processed_at);

-- 5. Indexes for fast instance lookup and worker job claiming
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_instance_id
ON provisioning_jobs (instance_id)
WHERE instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_worker_claim
ON provisioning_jobs (status, next_retry_at, locked_until)
WHERE status IN ('PENDING', 'PROCESSING', 'RETRYING');
