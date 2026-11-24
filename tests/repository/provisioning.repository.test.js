import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    createProvisioningJob,
    claimDueProvisioningJobs,
    failExhaustedProvisioningJobs,
    scheduleProvisioningRetry,
    markProvisioningSucceeded,
    markProvisioningFailed,
    cancelProvisioningJob,
    markJobNotified,
    findUnnotifiedSucceededJobs,
    WORKER_LOCK_MINUTES,
} from "../../src/services/database/provisioning.repository.js";
import { db } from "../../src/config/database.js";

describe("Provisioning Repository - Atomic Operations & Lock Guarantees", () => {
    let mockQueryResults = [];

    beforeEach(() => {
        mockQueryResults = [];
        db.query = async (queryText, values) => {
            const nextResult = mockQueryResults.shift();
            if (nextResult instanceof Error) {
                throw nextResult;
            }
            if (typeof nextResult === "function") {
                return nextResult(queryText, values);
            }
            return nextResult || { rows: [], rowCount: 0 };
        };
    });

    it("createProvisioningJob should be idempotent using retry_token", async () => {
        const jobData = {
            telegramUserId: 111,
            telegramChatId: 222,
            displayName: "vps-test",
            shape: "VM.Standard.A1.Flex",
            availabilityDomain: "AD-1",
            config: { ocpus: 1 },
            retryToken: "unique-token-123",
            maxAttempts: 20,
        };

        // First attempt: created successfully
        mockQueryResults.push({
            rows: [{ id: "job-1", retry_token: "unique-token-123", status: "PENDING" }],
            rowCount: 1,
        });

        const firstResult = await createProvisioningJob(jobData);
        assert.equal(firstResult.created, true);
        assert.equal(firstResult.job.id, "job-1");

        // Second attempt: conflict on retry_token, returns existing job
        mockQueryResults.push({ rows: [], rowCount: 0 }); // INSERT returns nothing on conflict
        mockQueryResults.push({
            rows: [{ id: "job-1", retry_token: "unique-token-123", status: "PENDING" }],
            rowCount: 1,
        }); // SELECT returns existing

        const secondResult = await createProvisioningJob(jobData);
        assert.equal(secondResult.created, false);
        assert.equal(secondResult.job.id, "job-1");
    });

    it("claimDueProvisioningJobs should claim due job and assign worker lock", async () => {
        const workerId = "worker-abc-123";

        mockQueryResults.push((queryText, values) => {
            assert.equal(values[0], workerId);
            assert.equal(values[1], 1);
            assert.equal(values[2], WORKER_LOCK_MINUTES);
            assert.equal(queryText.includes("FOR UPDATE SKIP LOCKED"), true);

            return {
                rows: [{
                    id: "job-1",
                    status: "PROCESSING",
                    locked_by: workerId,
                    attempt_count: 1,
                }],
                rowCount: 1,
            };
        });

        const claimed = await claimDueProvisioningJobs(workerId, 1);
        assert.equal(claimed.length, 1);
        assert.equal(claimed[0].locked_by, workerId);
        assert.equal(claimed[0].status, "PROCESSING");
    });

    it("claimDueProvisioningJobs should return empty when no due jobs exist", async () => {
        mockQueryResults.push({ rows: [], rowCount: 0 });
        const claimed = await claimDueProvisioningJobs("worker-1", 1);
        assert.equal(claimed.length, 0);
    });

    it("scheduleProvisioningRetry should atomically transition to RETRYING and clear locks", async () => {
        const workerId = "worker-1";
        const nextRetryAt = new Date(Date.now() + 60000);

        mockQueryResults.push((queryText, values) => {
            assert.equal(values[0], "job-1");
            assert.equal(values[1], nextRetryAt);
            assert.equal(values[2], "OutOfHostCapacity");
            assert.equal(values[4], workerId);

            return {
                rows: [{
                    id: "job-1",
                    status: "RETRYING",
                    locked_by: null,
                    next_retry_at: nextRetryAt,
                }],
                rowCount: 1,
            };
        });

        const scheduled = await scheduleProvisioningRetry("job-1", {
            nextRetryAt,
            errorCode: "OutOfHostCapacity",
            errorMessage: "No capacity",
        }, workerId);

        assert.equal(scheduled.status, "RETRYING");
        assert.equal(scheduled.locked_by, null);
    });

    it("markProvisioningSucceeded should require worker lock ownership", async () => {
        const workerId = "worker-1";

        mockQueryResults.push((queryText, values) => {
            // Verify worker lock condition
            assert.equal(queryText.includes("locked_by = $4"), true);
            assert.equal(values[3], workerId);

            return {
                rows: [{
                    id: "job-1",
                    status: "SUCCEEDED",
                    instance_id: "ocid1.instance.oc1..test",
                    instance_state: "RUNNING",
                }],
                rowCount: 1,
            };
        });

        const succeeded = await markProvisioningSucceeded("job-1", {
            instanceId: "ocid1.instance.oc1..test",
            instanceState: "RUNNING",
        }, workerId);

        assert.equal(succeeded.status, "SUCCEEDED");
        assert.equal(succeeded.instance_id, "ocid1.instance.oc1..test");
    });

    it("markProvisioningSucceeded should fail if lock expired or belongs to another worker", async () => {
        // DB update returns 0 rows because locked_by did not match or locked_until expired
        mockQueryResults.push({ rows: [], rowCount: 0 });

        const result = await markProvisioningSucceeded("job-1", {
            instanceId: "ocid1.instance.oc1..test",
            instanceState: "RUNNING",
        }, "worker-other");

        assert.equal(result, null);
    });

    it("failExhaustedProvisioningJobs should fail jobs exceeding max attempts", async () => {
        mockQueryResults.push({
            rows: [{ id: "job-exhausted-1", telegram_user_id: 111, display_name: "vps-1" }],
            rowCount: 1,
        });

        const exhausted = await failExhaustedProvisioningJobs();
        assert.equal(exhausted.length, 1);
        assert.equal(exhausted[0].id, "job-exhausted-1");
    });

    it("markJobNotified should be atomic and prevent duplicate notifications", async () => {
        // First notification: succeeds
        mockQueryResults.push({
            rows: [{ id: "job-1", notified_at: new Date() }],
            rowCount: 1,
        });

        const first = await markJobNotified("job-1");
        assert.notEqual(first, null);

        // Second notification: already notified, returns null
        mockQueryResults.push({ rows: [], rowCount: 0 });
        const second = await markJobNotified("job-1");
        assert.equal(second, null);
    });
});
