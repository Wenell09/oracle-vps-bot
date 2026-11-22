import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";

const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!secret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is required");
}

const handleUpdate = webhookCallback(bot, "https", {
    secretToken: secret,
    timeoutMilliseconds: 8000,
});

export default async function handler(req, res) {
    console.log("[WEBHOOK] Request received:", {
        method: req.method,
        contentType: req.headers["content-type"],
        hasSecret: Boolean(req.headers["x-telegram-bot-api-secret-token"]),
    });

    return handleUpdate(req, res);
}
