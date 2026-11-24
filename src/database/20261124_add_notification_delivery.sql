ALTER TABLE provisioning_jobs
    ADD COLUMN IF NOT EXISTS notification_locked_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS notification_locked_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notification_attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS notification_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_notification_recovery
ON provisioning_jobs (completed_at, created_at)
WHERE notified_at IS NULL
    AND status IN ('SUCCEEDED', 'FAILED');