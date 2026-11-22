
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

// Update logging
bot.use(async (ctx, next) => {
    console.log("[BOT] Update received:", {
        updateId: ctx.update.update_id,
        userId: ctx.from?.id,
        text: ctx.message?.text,
        chatId: ctx.chat?.id,
    });

    await next();
});

// User authorization middleware
bot.use(async (ctx, next) => {
    const allowedUserId = process.env.ALLOWED_TELEGRAM_USER_ID;

    if (
        allowedUserId &&
        String(ctx.from?.id) !== String(allowedUserId)
    ) {
        console.log("[BOT] Unauthorized user:", ctx.from?.id);

        await ctx.reply("Unauthorized user.");
        return;
    }

    await next();
});

// Register commands
bot.command("start", startCommand);
bot.command("help", helpCommand);
bot.command("ping", pingCommand);
bot.command("id", idCommand);

registerOciTestCommand(bot);

// Error handler
bot.catch((error) => {
    console.error("[BOT] Telegram bot error:", {
        message: error.message,
        stack: error.stack,
        error: error.error,
    });
});
