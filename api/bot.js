import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";

const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!secret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is required");
}

export default webhookCallback(bot, "https", {
    secretToken: secret,
    timeoutMilliseconds: 8000,
});