import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import cronHandler from "../../api/cron.js";

describe("Cron Scheduler Endpoint - /api/cron", () => {
    const CRON_SECRET = "cron-secret-123";
    const WORKER_SECRET = "worker-secret-456";

    beforeEach(() => {
        process.env.CRON_SECRET = CRON_SECRET;
        process.env.WORKER_SECRET = WORKER_SECRET;
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
        await cronHandler(req, res);
        assert.equal(res.statusCode, 405);
    });

    it("should reject invocations that pass secrets in query parameters", async () => {
        const { req, res } = createMockReqRes({
            method: "GET",
            query: { secret: "exposed-in-url" },
        });
        await cronHandler(req, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.message.includes("query parameters"), true);
    });

    it("should reject unauthorized requests with missing or invalid authorization", async () => {
        const { req, res } = createMockReqRes({
            method: "GET",
            headers: { authorization: "Bearer invalid-token" },
        });
        await cronHandler(req, res);
        assert.equal(res.statusCode, 401);
    });

    it("should accept authorized cron invocations with valid CRON_SECRET", async () => {
        // Mock global fetch to verify HTTP POST to worker endpoint
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

            await cronHandler(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(fetchOptionsUsed.method, "POST");
            assert.equal(fetchOptionsUsed.headers.Authorization, `Bearer ${WORKER_SECRET}`);
            assert.equal(fetchUrlCalled.endsWith("/api/worker"), true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
