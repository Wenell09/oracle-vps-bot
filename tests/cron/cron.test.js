import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import cronWorkerHandler from "../../api/cron/worker.js";
import cronAliasHandler from "../../api/cron.js";
import { db } from "../../src/config/database.js";

describe("Dedicated Cron Worker Endpoint - /api/cron/worker", () => {
    const CRON_SECRET = "cron-secret-123";
    const WORKER_SECRET = "worker-secret-456";
    const BYPASS_SECRET = "bypass-secret-abc";
    let originalQuery;
    let originalFetch;

    beforeEach(() => {
        process.env.CRON_SECRET = CRON_SECRET;
        process.env.WORKER_SECRET = WORKER_SECRET;
        delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        delete process.env.APP_URL;
        delete process.env.VERCEL_URL;
        originalQuery = db.query;
        originalFetch = globalThis.fetch;
        db.query = async () => ({ rows: [], rowCount: 0 });
    });

    afterEach(() => {
        db.query = originalQuery;
        globalThis.fetch = originalFetch;
        delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        delete process.env.APP_URL;
        delete process.env.VERCEL_URL;
    });

    function createMockReqRes({
        method = "GET",
        headers = { authorization: `Bearer ${CRON_SECRET}` },
        query = {},
    } = {}) {
        const req = { method, headers, query };
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

    // ── Authentication ──────────────────────────────────────────────────────

    it("should reject disallowed HTTP methods (PUT, DELETE)", async () => {
        const { req, res } = createMockReqRes({ method: "PUT" });
        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 405);
        assert.ok(res.body.message.includes("Method not allowed"));
    });

    it("should reject invocations that pass secrets in query parameters", async () => {
        const { req, res } = createMockReqRes({
            method: "GET",
            query: { secret: "exposed-in-url" },
        });
        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 400);
        assert.ok(res.body.message.includes("query parameters"));
    });

    it("should reject missing CRON_SECRET (no Authorization header)", async () => {
        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {},
        });
        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 401);
        assert.ok(res.body.message.includes("Unauthorized"));
    });

    it("should reject invalid CRON_SECRET", async () => {
        const { req, res } = createMockReqRes({
            method: "GET",
            headers: { authorization: "Bearer wrong-secret" },
        });
        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 401);
        assert.ok(res.body.message.includes("Unauthorized"));
    });

    it("should accept valid CRON_SECRET", async () => {
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, processed: 0, message: "No due provisioning jobs" }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "my-app.vercel.app",
            },
        });

        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
    });

    // ── URL resolution ──────────────────────────────────────────────────────

    it("should prefer APP_URL over x-forwarded-host and VERCEL_URL for stable production URL", async () => {
        process.env.APP_URL = "https://my-stable-app.vercel.app";
        process.env.VERCEL_URL = "my-app-git-abc123-team.vercel.app"; // generated – must be ignored

        let fetchedUrl = null;
        globalThis.fetch = async (url) => {
            fetchedUrl = url;
            return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, processed: 0, message: "No due provisioning jobs" }),
            };
        };

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "some-other-host.vercel.app",
                "x-forwarded-host": "another-host.vercel.app",
            },
        });

        await cronWorkerHandler(req, res);

        assert.ok(fetchedUrl, "fetch should have been called");
        assert.ok(
            fetchedUrl.startsWith("https://my-stable-app.vercel.app"),
            `Expected APP_URL-based URL, got: ${fetchedUrl}`
        );
        assert.equal(fetchedUrl, "https://my-stable-app.vercel.app/api/worker");
    });

    it("should NOT use VERCEL_URL (generated deployment URL) when APP_URL is absent", async () => {
        delete process.env.APP_URL;
        process.env.VERCEL_URL = "my-app-git-abc123-team.vercel.app";

        let fetchedUrl = null;
        globalThis.fetch = async (url) => {
            fetchedUrl = url;
            return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, processed: 0 }),
            };
        };

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "my-stable-app.vercel.app",
            },
        });

        await cronWorkerHandler(req, res);

        assert.ok(fetchedUrl, "fetch should have been called");
        assert.ok(
            !fetchedUrl.includes("my-app-git-abc123-team.vercel.app"),
            `VERCEL_URL must not be used; got: ${fetchedUrl}`
        );
    });

    // ── Vercel Deployment Protection bypass ─────────────────────────────────

    it("should send x-vercel-protection-bypass header when VERCEL_AUTOMATION_BYPASS_SECRET is set", async () => {
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET = BYPASS_SECRET;

        let capturedHeaders = null;
        globalThis.fetch = async (url, options) => {
            capturedHeaders = options.headers;
            return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, processed: 0, message: "No due provisioning jobs" }),
            };
        };

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.ok(capturedHeaders, "fetch should have been called");
        assert.equal(
            capturedHeaders["x-vercel-protection-bypass"],
            BYPASS_SECRET,
            "x-vercel-protection-bypass header must equal VERCEL_AUTOMATION_BYPASS_SECRET"
        );
    });

    it("should NOT send x-vercel-protection-bypass header when VERCEL_AUTOMATION_BYPASS_SECRET is absent", async () => {
        delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

        let capturedHeaders = null;
        globalThis.fetch = async (url, options) => {
            capturedHeaders = options.headers;
            return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, processed: 0 }),
            };
        };

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.ok(capturedHeaders, "fetch should have been called");
        assert.equal(
            capturedHeaders["x-vercel-protection-bypass"],
            undefined,
            "bypass header must be absent when secret is not configured"
        );
    });

    // ── Worker authentication ────────────────────────────────────────────────

    it("should call /api/worker via POST with WORKER_SECRET Authorization header", async () => {
        let fetchUrlCalled = null;
        let fetchOptionsUsed = null;

        globalThis.fetch = async (url, options) => {
            fetchUrlCalled = url;
            fetchOptionsUsed = options;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    processed: 0,
                    message: "No due provisioning jobs",
                }),
            };
        };

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(fetchOptionsUsed.method, "POST");
        assert.equal(
            fetchOptionsUsed.headers.Authorization,
            `Bearer ${WORKER_SECRET}`,
            "Must authenticate /api/worker with WORKER_SECRET"
        );
        assert.ok(fetchUrlCalled.endsWith("/api/worker"));
    });

    it("should NOT expose bypass secret in the response body", async () => {
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET = BYPASS_SECRET;

        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, processed: 0, message: "No due provisioning jobs" }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        const bodyStr = JSON.stringify(res.body);
        assert.ok(!bodyStr.includes(BYPASS_SECRET), "VERCEL_AUTOMATION_BYPASS_SECRET must never appear in response");
        assert.ok(!bodyStr.includes(WORKER_SECRET), "WORKER_SECRET must never appear in response");
        assert.ok(!bodyStr.includes(CRON_SECRET), "CRON_SECRET must never appear in response");
    });

    it("should NOT expose the internal worker URL in the response body", async () => {
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, processed: 0, message: "No due provisioning jobs" }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.equal(
            res.body.invokedUrl,
            undefined,
            "invokedUrl must not be present in response"
        );
    });

    // ── Worker HTTP error handling ───────────────────────────────────────────

    it("should propagate worker HTTP 401 as a failed cron execution (not success)", async () => {
        globalThis.fetch = async () => ({
            ok: false,
            status: 401,
            json: async () => ({ success: false, message: "Unauthorized" }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.equal(res.statusCode, 401, "cron endpoint must reflect worker 401 status");
        assert.equal(res.body.success, false, "success must be false when worker returns 401");
    });

    it("should propagate worker HTTP 500 as a failed cron execution (not success)", async () => {
        globalThis.fetch = async () => ({
            ok: false,
            status: 500,
            json: async () => ({ success: false, message: "Internal Server Error" }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.equal(res.statusCode, 500, "cron endpoint must reflect worker 500 status");
        assert.equal(res.body.success, false, "success must be false when worker returns 500");
    });

    // ── No due jobs ──────────────────────────────────────────────────────────

    it("should return success when worker reports no due jobs", async () => {
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, processed: 0, message: "No due provisioning jobs" }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.workerResponse.processed, 0);
    });

    // ── Successful job processing ────────────────────────────────────────────

    it("should return success when worker processes a job successfully", async () => {
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                processed: 1,
                jobId: "job-123",
                status: "SUCCEEDED",
            }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.workerResponse.processed, 1);
        assert.equal(res.body.workerResponse.status, "SUCCEEDED");
    });

    // ── Loopback fallback (in-process) ───────────────────────────────────────

    it("should fallback to in-process delegation if loopback fetch fails", async () => {
        globalThis.fetch = async () => {
            throw new Error("Loopback connection refused");
        };

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.delegatedInProcess, true);
    });

    it("should report in-process worker failure correctly (success: false when worker errors)", async () => {
        globalThis.fetch = async () => {
            throw new Error("Loopback connection refused");
        };

        // Force the in-process worker to throw by making the DB raise an error
        db.query = async () => {
            throw new Error("Simulated DB failure during in-process fallback");
        };

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronWorkerHandler(req, res);

        // In-process worker throws → simulatedRes is never called → outer catch sends 500
        assert.equal(res.statusCode, 500, "status must be 500 when in-process worker throws");
        assert.equal(res.body.success, false, "success must be false when in-process worker throws");
    });

    // ── Backward compatibility alias ─────────────────────────────────────────

    it("should maintain backward compatibility through /api/cron alias handler", async () => {
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                processed: 0,
                message: "No due provisioning jobs",
            }),
        });

        const { req, res } = createMockReqRes({
            method: "GET",
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
                host: "localhost:3000",
            },
        });

        await cronAliasHandler(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
    });
});
