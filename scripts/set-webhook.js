import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !appUrl || !secret) {
    throw new Error("Missing required environment variables");
}

const bot = new Bot(token);

const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/bot`;

try {
    const me = await bot.api.getMe();

    console.log(`Connected to Telegram: @${me.username}`);
    console.log(`Registering webhook: ${webhookUrl}`);

    const result = await bot.api.setWebhook(webhookUrl, {
        secret_token: secret,
        allowed_updates: [
            "message",
            "callback_query",
        ],
        max_connections: 1,
    });

    console.log("Webhook successfully configured:", result);

    const webhookInfo = await bot.api.getWebhookInfo();

    console.log("[WEBHOOK INFO]", {
        url: webhookInfo.url,
        allowedUpdates: webhookInfo.allowed_updates,
        pendingUpdateCount: webhookInfo.pending_update_count,
    });
} catch (error) {
    console.error("Failed to configure webhook:", error);
    process.exit(1);
}