import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import workerHandler from "../../api/worker.js";
import { db } from "../../src/config/database.js";

describe("Worker - 10 Core Execution Scenarios", () => {
    after(async () => {
        try {
            await db.end();
        } catch (_) {}
    });
    const TEST_SECRET = "test-worker-secret-xyz";
    let originalQuery;
    let dbState;

    beforeEach(() => {
        process.env.WORKER_SECRET = TEST_SECRET;
        originalQuery = db.query;

        dbState = {
            claimedJobs: [],
            exhaustedJobs: [],
            succeededJob: null,
            retriedJob: null,
            failedJob: null,
            markSucceededSuccess: true,
            markFailedSuccess: true,
            scheduleRetrySuccess: true,
        };

        db.query = async (sql, values) => {
            // Unnotified jobs recovery query
            if (sql.includes("notified_at IS NULL") && sql.includes("SELECT")) {
                return { rows: [], rowCount: 0 };
            }

            // failExhaustedProvisioningJobs
            if (sql.includes("MAX_ATTEMPTS_REACHED") || (sql.includes("WHERE status IN ('RETRYING', 'PROCESSING')") && sql.includes("UPDATE"))) {
                return { rows: dbState.exhaustedJobs, rowCount: dbState.exhaustedJobs.length };
            }

            // claimDueProvisioningJobs
            if (sql.includes("WITH selected_jobs AS")) {
                return { rows: dbState.claimedJobs, rowCount: dbState.claimedJobs.length };
            }

            // markProvisioningSucceeded
            if (sql.includes("status = 'SUCCEEDED'")) {
                if (!dbState.markSucceededSuccess) {
                    return { rows: [], rowCount: 0 }; // Lock expired or worker mismatch
                }
                const result = dbState.succeededJob || { id: values[0], status: "SUCCEEDED" };
                return { rows: [result], rowCount: 1 };
            }

            // scheduleProvisioningRetry
            if (sql.includes("status = 'RETRYING'")) {
                if (!dbState.scheduleRetrySuccess) {
                    return { rows: [], rowCount: 0 };
                }
                const result = dbState.retriedJob || {
                    id: values[0],
                    status: "RETRYING",
                    next_retry_at: values[1],
                    attempt_count: 1,
                    max_attempts: 20,
                };
                return { rows: [result], rowCount: 1 };
            }

            // markProvisioningFailed
            if (sql.includes("status = 'FAILED'")) {
                if (!dbState.markFailedSuccess) {
                    return { rows: [], rowCount: 0 };
                }
                const result = dbState.failedJob || { id: values[0], status: "FAILED" };
                return { rows: [result], rowCount: 1 };
            }

            // markJobNotified
            if (sql.includes("notified_at = NOW()")) {
                return { rows: [{ id: values[0] }], rowCount: 1 };
            }

            return { rows: [], rowCount: 0 };
        };

        delete globalThis.__ociComputeClientMock;
    });

    afterEach(() => {
        db.query = originalQuery;
        delete globalThis.__ociComputeClientMock;
    });

    function createMockReqRes({
        method = "POST",
        headers = { authorization: `Bearer ${TEST_SECRET}` },
    } = {}) {
        const req = { method, headers };
        const res = {
            statusCode: 200,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(data) {
                this.body = data;
                return this;
            },
        };
        return { req, res };
    }

    // Scenario 1: No due jobs
    it("Scenario 1: should return 200 with processed = 0 when no jobs are due", async () => {
        dbState.claimedJobs = [];

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.processed, 0);
        assert.equal(res.body.message, "No due provisioning jobs");
    });

    // Scenario 2: Existing OCI instance found (reconciled without new launch)
    it("Scenario 2: should reconcile existing OCI instance and not launch duplicate", async () => {
        const testJob = {
            id: "job-reconcile-1",
            config: { compartmentId: "comp-1", availabilityDomain: "AD-1", displayName: "oracle-vps-01" },
            retry_token: "token-1",
            attempt_count: 1,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];

        let launchCalled = false;
        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({
                    items: [{ id: "ocid1.inst.1", displayName: "oracle-vps-01" }],
                }),
                getInstance: async () => ({
                    instance: {
                        id: "ocid1.inst.1",
                        displayName: "oracle-vps-01",
                        lifecycleState: "RUNNING",
                        freeformTags: { provisioningJobId: testJob.id },
                    },
                }),
                launchInstance: async () => {
                    launchCalled = true;
                },
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reconciled, true);
        assert.equal(res.body.status, "SUCCEEDED");
        assert.equal(launchCalled, false, "launchInstance must NOT be called when existing instance is reconciled");
    });

    // Scenario 3: No instance found and launch succeeds
    it("Scenario 3: should launch new VPS when no existing instance found", async () => {
        const testJob = {
            id: "job-new-1",
            config: {
                compartmentId: "comp-1",
                availabilityDomain: "AD-1",
                displayName: "oracle-vps-01",
                shape: "VM.Standard.A1.Flex",
                ocpus: 1,
                memoryInGBs: 6,
                imageId: "img-1",
                bootVolumeSizeInGBs: 50,
                subnetId: "sub-1",
                sshPublicKey: "ssh-ed25519 AAAAC3 test",
            },
            retry_token: "token-new",
            attempt_count: 1,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];

        let launchTokenUsed = null;
        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({ items: [] }),
                launchInstance: async ({ opcRetryToken }) => {
                    launchTokenUsed = opcRetryToken;
                    return {
                        instance: {
                            id: "ocid1.inst.new-1",
                            displayName: "oracle-vps-01",
                            lifecycleState: "PROVISIONING",
                        },
                    };
                },
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reconciled, false);
        assert.equal(res.body.status, "SUCCEEDED");
        assert.equal(launchTokenUsed, testJob.retry_token);
    });

    // Scenario 4: Launch fails with OutOfHostCapacity (retry scheduled)
    it("Scenario 4: should schedule retry on OutOfHostCapacity failure", async () => {
        const testJob = {
            id: "job-capacity-1",
            config: {
                compartmentId: "comp-1",
                availabilityDomain: "AD-1",
                displayName: "oracle-vps-01",
                shape: "VM.Standard.A1.Flex",
                ocpus: 1,
                memoryInGBs: 6,
                imageId: "img-1",
                bootVolumeSizeInGBs: 50,
                subnetId: "sub-1",
                sshPublicKey: "ssh-ed25519 AAAAC3 test",
            },
            retry_token: "token-cap",
            attempt_count: 2,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];

        const capacityError = new Error("Out of host capacity");
        capacityError.serviceCode = "OutOfHostCapacity";

        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({ items: [] }),
                launchInstance: async () => {
                    throw capacityError;
                },
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status, "RETRYING");
        assert.equal(res.body.retryScheduled, true);
    });

    // Scenario 5: OCI reconciliation fails
    it("Scenario 5: should abort execution without launching if reconciliation fails", async () => {
        const testJob = {
            id: "job-recon-fail-1",
            config: { compartmentId: "comp-1", availabilityDomain: "AD-1", displayName: "oracle-vps-01" },
            retry_token: "token-fail",
            attempt_count: 1,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];

        let launchCalled = false;
        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => {
                    const err = new Error("OCI network timeout");
                    err.code = "ETIMEDOUT";
                    throw err;
                },
                launchInstance: async () => {
                    launchCalled = true;
                },
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(launchCalled, false, "Must not launch if reconciliation fails");
    });

    // Scenario 6: Launch times out with an ambiguous result
    it("Scenario 6: should treat launch timeout as retryable failure without duplicate launch", async () => {
        const testJob = {
            id: "job-timeout-1",
            config: {
                compartmentId: "comp-1",
                availabilityDomain: "AD-1",
                displayName: "oracle-vps-01",
                shape: "VM.Standard.A1.Flex",
                ocpus: 1,
                memoryInGBs: 6,
                imageId: "img-1",
                bootVolumeSizeInGBs: 50,
                subnetId: "sub-1",
                sshPublicKey: "ssh-ed25519 AAAAC3 test",
            },
            retry_token: "token-timeout",
            attempt_count: 1,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];

        const timeoutErr = new Error("Request to OCI timed out");
        timeoutErr.code = "ETIMEDOUT";

        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({ items: [] }),
                launchInstance: async () => {
                    throw timeoutErr;
                },
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status, "RETRYING");
        assert.equal(res.body.retryScheduled, true);
    });

    // Scenario 7: Job lock expires
    it("Scenario 7: should reject completion when worker lock has expired", async () => {
        const testJob = {
            id: "job-lock-exp-1",
            config: {
                compartmentId: "comp-1",
                availabilityDomain: "AD-1",
                displayName: "oracle-vps-01",
                shape: "VM.Standard.A1.Flex",
                ocpus: 1,
                memoryInGBs: 6,
                imageId: "img-1",
                bootVolumeSizeInGBs: 50,
                subnetId: "sub-1",
                sshPublicKey: "ssh-ed25519 AAAAC3 test",
            },
            retry_token: "token-exp",
            attempt_count: 1,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];
        dbState.markSucceededSuccess = false; // Simulates expired lock

        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({ items: [] }),
                launchInstance: async () => ({
                    instance: { id: "ocid1.inst.1", lifecycleState: "RUNNING" },
                }),
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.error.includes("no longer belongs to worker"), true);
    });

    // Scenario 8: Job no longer belongs to the worker
    it("Scenario 8: should reject status update when job is claimed by another worker", async () => {
        const testJob = {
            id: "job-other-worker-1",
            config: {
                compartmentId: "comp-1",
                availabilityDomain: "AD-1",
                displayName: "oracle-vps-01",
                shape: "VM.Standard.A1.Flex",
                ocpus: 1,
                memoryInGBs: 6,
                imageId: "img-1",
                bootVolumeSizeInGBs: 50,
                subnetId: "sub-1",
                sshPublicKey: "ssh-ed25519 AAAAC3 test",
            },
            retry_token: "token-other",
            attempt_count: 1,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];
        dbState.markSucceededSuccess = false;

        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({ items: [] }),
                launchInstance: async () => ({
                    instance: { id: "ocid1.inst.1", lifecycleState: "RUNNING" },
                }),
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 500);
    });

    // Scenario 9: Maximum retry attempts reached
    it("Scenario 9: should mark job as FAILED when max attempts are reached", async () => {
        const testJob = {
            id: "job-exhausted-max",
            config: {
                compartmentId: "comp-1",
                availabilityDomain: "AD-1",
                displayName: "oracle-vps-01",
                shape: "VM.Standard.A1.Flex",
                ocpus: 1,
                memoryInGBs: 6,
                imageId: "img-1",
                bootVolumeSizeInGBs: 50,
                subnetId: "sub-1",
                sshPublicKey: "ssh-ed25519 AAAAC3 test",
            },
            retry_token: "token-max",
            attempt_count: 20,
            max_attempts: 20,
        };
        dbState.claimedJobs = [testJob];

        const capacityError = new Error("Out of host capacity");
        capacityError.serviceCode = "OutOfHostCapacity";

        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({ items: [] }),
                launchInstance: async () => {
                    throw capacityError;
                },
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        const { req, res } = createMockReqRes();
        await workerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status, "FAILED");
        assert.equal(res.body.reason, "MAX_ATTEMPTS_REACHED");
    });

    // Scenario 10: Duplicate worker invocation
    it("Scenario 10: should safely handle duplicate worker invocation using concurrency locks", async () => {
        const testJob = {
            id: "job-concurrent-1",
            config: {
                compartmentId: "comp-1",
                availabilityDomain: "AD-1",
                displayName: "oracle-vps-01",
                shape: "VM.Standard.A1.Flex",
                ocpus: 1,
                memoryInGBs: 6,
                imageId: "img-1",
                bootVolumeSizeInGBs: 50,
                subnetId: "sub-1",
                sshPublicKey: "ssh-ed25519 AAAAC3 test",
            },
            retry_token: "token-conc",
            attempt_count: 1,
            max_attempts: 20,
        };

        globalThis.__ociComputeClientMock = {
            computeClient: {
                listInstances: async () => ({ items: [] }),
                launchInstance: async () => ({
                    instance: { id: "ocid1.inst.1", lifecycleState: "RUNNING" },
                }),
                close: async () => {},
            },
            config: { tenancyOCID: "tenancy-1", region: "ap-batam-1" },
        };

        // Worker 1 claims job
        dbState.claimedJobs = [testJob];
        const { req: req1, res: res1 } = createMockReqRes();
        await workerHandler(req1, res1);

        // Worker 2 (concurrent) gets 0 due to SKIP LOCKED
        dbState.claimedJobs = [];
        const { req: req2, res: res2 } = createMockReqRes();
        await workerHandler(req2, res2);

        assert.equal(res1.statusCode, 200);
        assert.equal(res1.body.processed, 1);
        assert.equal(res2.statusCode, 200);
        assert.equal(res2.body.processed, 0);
    });
});
