
import "dotenv/config";

import { Bot } from "grammy";

import { registerOciTestCommand } from "./commands/oci-test.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { pingCommand } from "./commands/ping.js";
import { idCommand } from "./commands/id.js";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Bot(token);

// Global error handler
bot.catch((error) => {
    console.error("[BOT] Unhandled error:", {
        message: error.message,
        stack: error.stack,
        error: error.error,
    });
});

// Middleware: Log incoming updates
bot.use(async (ctx, next) => {
    console.log("[BOT] Update received:", {
        updateId: ctx.update.update_id,
        userId: ctx.from?.id,
        text: ctx.message?.text,
        chatId: ctx.chat?.id,
    });

    await next();
});

// Middleware: User authorization
bot.use(async (ctx, next) => {
    const allowedUserId = process.env.ALLOWED_TELEGRAM_USER_ID;

    const receivedUserId = String(ctx.from?.id ?? "");

    const isAuthorized =
        !allowedUserId ||
        receivedUserId === String(allowedUserId).trim();

    console.log("[AUTH] Authorization check:", {
        receivedUserId,
        allowedUserId: allowedUserId ? "CONFIGURED" : "NOT_CONFIGURED",
        isAuthorized,
    });

    if (!isAuthorized) {
        console.log("[AUTH] Unauthorized user:", receivedUserId);

        await ctx.reply("Unauthorized user.");
        return;
    }

    console.log("[AUTH] User authorized:", receivedUserId);

    await next();
});

// Register standard commands
bot.command("start", startCommand);
bot.command("help", helpCommand);
bot.command("ping", pingCommand);
bot.command("id", idCommand);

// Register OCI test command
registerOciTestCommand(bot);

console.log("[BOT] All commands registered successfully");

// Log command registration execution
bot.command("oci-test", async (ctx) => {
    console.log("[OCI-TEST] Fallback handler triggered");
    await ctx.reply("OCI test command reached fallback handler.");
});
