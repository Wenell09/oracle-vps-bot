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

// User authorization middleware
bot.use(async (ctx, next) => {
    const allowedUserId = process.env.ALLOWED_TELEGRAM_USER_ID;

    if (
        allowedUserId &&
        String(ctx.from?.id) !== String(allowedUserId)
    ) {
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

// Command OCI baru
registerOciTestCommand(bot);

// Error handler
bot.catch((error) => {
    console.error("Telegram bot error:", error);
});