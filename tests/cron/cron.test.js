import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import cronWorkerHandler from "../../api/cron/worker.js";
import cronAliasHandler from "../../api/cron.js";
import { db } from "../../src/config/database.js";

describe("Dedicated Cron Worker Endpoint - /api/cron/worker", () => {
    const CRON_SECRET = "cron-secret-123";
    const WORKER_SECRET = "worker-secret-456";
    let originalQuery;

    beforeEach(() => {
        process.env.CRON_SECRET = CRON_SECRET;
        process.env.WORKER_SECRET = WORKER_SECRET;
        originalQuery = db.query;
        db.query = async () => ({ rows: [], rowCount: 0 });
    });

    afterEach(() => {
        db.query = originalQuery;
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

    it("should reject disallowed HTTP methods (PUT, DELETE)", async () => {
        const { req, res } = createMockReqRes({ method: "PUT" });
        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 405);
        assert.equal(res.body.message.includes("Method not allowed"), true);
    });

    it("should reject invocations that pass secrets in query parameters", async () => {
        const { req, res } = createMockReqRes({
            method: "GET",
            query: { secret: "exposed-in-url" },
        });
        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.message.includes("query parameters"), true);
    });

    it("should reject unauthorized requests with missing or invalid authorization", async () => {
        const { req, res } = createMockReqRes({
            method: "GET",
            headers: { authorization: "Bearer invalid-token" },
        });
        await cronWorkerHandler(req, res);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.message.includes("Unauthorized"), true);
    });

    it("should accept authorized cron invocations with valid CRON_SECRET and call /api/worker via POST with WORKER_SECRET", async () => {
        const originalFetch = globalThis.fetch;
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

        try {
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
            assert.equal(fetchOptionsUsed.headers.Authorization, `Bearer ${WORKER_SECRET}`);
            assert.equal(fetchUrlCalled.endsWith("/api/worker"), true);
            assert.equal(res.body.success, true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("should fallback to in-process delegation if loopback fetch fails", async () => {
        const originalFetch = globalThis.fetch;

        // Simulate loopback fetch network error in serverless environment
        globalThis.fetch = async () => {
            throw new Error("Loopback connection refused");
        };

        try {
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
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("should maintain backward compatibility through /api/cron alias handler", async () => {
        const originalFetch = globalThis.fetch;

        globalThis.fetch = async (url, options) => {
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

        try {
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
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
