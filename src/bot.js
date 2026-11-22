import "dotenv/config";
import { Bot } from "grammy";
import { testOciConnection } from "./services/oci/identity.service.js";
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
        entities: ctx.message?.entities,
        chatId: ctx.chat?.id,
    });
    await next();
    console.log("[BOT] Middleware chain completed:", {
        updateId: ctx.update.update_id,
    });
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

// Standard commands
bot.command("start", startCommand);
bot.command("help", helpCommand);
bot.command("ping", pingCommand);
bot.command("id", idCommand);

bot.hears(/^\/oci-test(?:@\w+)?(?:\s|$)/, async (ctx) => {
    console.log("[OCI-TEST] HEARS HANDLER MATCHED");

    try {
        await ctx.reply("OCI test handler berhasil dijalankan.");

        console.log("[OCI-TEST] Test reply sent");
    } catch (error) {
        console.error("[OCI-TEST] Reply failed:", {
            message: error.message,
            description: error.description,
        });
    }
});

console.log("[BOT] All commands registered successfully");
