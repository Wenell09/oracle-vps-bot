import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { notifyProvisioningSuccess, notifyProvisioningFailure } from "../../src/services/telegram/notification.service.js";
import { recordTelegramUpdate } from "../../src/services/database/provisioning.repository.js";
import { helpCommand } from "../../src/commands/help.js";
import { startCommand } from "../../src/commands/start.js";
import { bot } from "../../src/bot.js";
import { db } from "../../src/config/database.js";

describe("Telegram Integration & Reliability Tests", () => {
    let sentMessages = [];
    let originalQuery;
    let mockDbResponses = [];

    beforeEach(() => {
        sentMessages = [];
        mockDbResponses = [];
        originalQuery = db.query;

        db.query = async (sql, values) => {
            if (mockDbResponses.length === 0) {
                return { rows: [], rowCount: 0 };
            }
            const next = mockDbResponses.shift();
            if (next instanceof Error) throw next;
            if (typeof next === "function") return next(sql, values);
            return next;
        };

        bot.api.sendMessage = async (chatId, text, options) => {
            sentMessages.push({ chatId, text, options });
            return { message_id: Math.floor(Math.random() * 1000) };
        };
    });

    afterEach(() => {
        db.query = originalQuery;
    });

    it("should prevent duplicate processing of Telegram updates via update_id deduplication", async () => {
        // First execution: insert succeeds
        mockDbResponses.push({
            rows: [{ update_id: 99887766 }],
            rowCount: 1,
        });

        const isFirstNew = await recordTelegramUpdate(99887766);
        assert.equal(isFirstNew, true);

        // Second execution: duplicate update returns 0 rows (ON CONFLICT DO NOTHING)
        mockDbResponses.push({
            rows: [],
            rowCount: 0,
        });

        const isSecondNew = await recordTelegramUpdate(99887766);
        assert.equal(isSecondNew, false);
    });

    it("should send rich provisioning success notification to Telegram user", async () => {
        const job = {
            id: "job-notify-success-1",
            telegram_user_id: 12345,
            telegram_chat_id: 67890,
            display_name: "test-vps",
            shape: "VM.Standard.A1.Flex",
            public_ip: "150.136.200.5",
            config: { ocpus: 1, memoryInGBs: 6 },
        };

        const instance = {
            id: "ocid1.instance.oc1..test",
            displayName: "test-vps",
            lifecycleState: "RUNNING",
            shape: "VM.Standard.A1.Flex",
            publicIp: "150.136.200.5",
        };

        // markJobNotified query succeeds:
        mockDbResponses.push({
            rows: [{ id: job.id, notified_at: new Date() }],
            rowCount: 1,
        });

        const sent = await notifyProvisioningSuccess(job, instance);
        assert.equal(sent, true);
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].chatId, 67890);
        assert.equal(sentMessages[0].text.includes("VPS PROVISIONING BERHASIL"), true);
        assert.equal(sentMessages[0].text.includes("150.136.200.5"), true);
        assert.equal(sentMessages[0].text.includes("ssh ubuntu@"), true);
    });

    it("should send terminal failure notification when max attempts reached", async () => {
        const job = {
            id: "job-notify-fail-1",
            telegram_user_id: 12345,
            telegram_chat_id: 67890,
            display_name: "test-vps",
            attempt_count: 20,
            max_attempts: 20,
        };

        mockDbResponses.push({
            rows: [{ id: job.id, notified_at: new Date() }],
            rowCount: 1,
        });

        const sent = await notifyProvisioningFailure(job, {
            reason: "MAX_ATTEMPTS_REACHED",
            errorMessage: "Out of host capacity",
        });

        assert.equal(sent, true);
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].text.includes("VPS PROVISIONING GAGAL"), true);
        assert.equal(sentMessages[0].text.includes("MAX_ATTEMPTS_REACHED"), true);
    });

    it("should guarantee notification idempotency and prevent duplicate Telegram messages", async () => {
        const job = {
            id: "job-idempotent-1",
            telegram_user_id: 12345,
            telegram_chat_id: 67890,
            display_name: "test-vps",
        };

        // First attempt: markJobNotified returns 1 row
        mockDbResponses.push({
            rows: [{ id: job.id, notified_at: new Date() }],
            rowCount: 1,
        });

        const first = await notifyProvisioningSuccess(job);
        assert.equal(first, true);
        assert.equal(sentMessages.length, 1);

        // Second attempt: markJobNotified returns 0 rows (already notified)
        mockDbResponses.push({
            rows: [],
            rowCount: 0,
        });

        const second = await notifyProvisioningSuccess(job);
        assert.equal(second, false);
        assert.equal(sentMessages.length, 1, "Must not send duplicate notification message");
    });

    it("should respond to /help with valid HTML and complete command list without throwing parse errors", async () => {
        let replyCalled = false;
        let replyText = "";
        let replyOptions = null;

        const mockCtx = {
            reply: async (text, options) => {
                replyCalled = true;
                replyText = text;
                replyOptions = options;
            },
        };

        await helpCommand(mockCtx);

        assert.equal(replyCalled, true);
        assert.equal(replyOptions?.parse_mode, "HTML");
        assert.equal(replyText.includes("PANDUAN PERINTAH BOT"), true);
        assert.equal(replyText.includes("/create"), true);
        assert.equal(replyText.includes("/status"), true);
        assert.equal(replyText.includes("/list"), true);
        assert.equal(replyText.includes("/delete"), true);
        assert.equal(replyText.includes("/oci_test"), true);
        assert.equal(replyText.includes("/list_shapes"), true);
    });

    it("should respond to /start with valid HTML and guidance without throwing parse errors", async () => {
        let replyCalled = false;
        let replyText = "";
        let replyOptions = null;

        const mockCtx = {
            reply: async (text, options) => {
                replyCalled = true;
                replyText = text;
                replyOptions = options;
            },
        };

        await startCommand(mockCtx);

        assert.equal(replyCalled, true);
        assert.equal(replyOptions?.parse_mode, "HTML");
        assert.equal(replyText.includes("Selamat datang di Oracle VPS Bot"), true);
        assert.equal(replyText.includes("/create"), true);
        assert.equal(replyText.includes("/status"), true);
    });
});
