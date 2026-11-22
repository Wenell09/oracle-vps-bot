import "dotenv/config";

import { Bot } from "grammy";

import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { pingCommand } from "./commands/ping.js";
import { idCommand } from "./commands/id.js";
import { ociTestCommand } from "./commands/oci-test.js";
import { listVpsCommand } from "./commands/list-vps.js";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Bot(token);

// Error handler
bot.catch((error) => {
    console.error("[BOT] Error:", error);
});

// Logging middleware
bot.use(async (ctx, next) => {
    console.log("[BOT] Update received:", {
        updateId: ctx.update.update_id,
        userId: ctx.from?.id,
        text: ctx.message?.text,
        chatId: ctx.chat?.id,
    });

    await next();
});

// Authorization middleware
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

    await next();
});

// Command registration
bot.command("start", startCommand);
bot.command("help", helpCommand);
bot.command("ping", pingCommand);
bot.command("id", idCommand);
bot.command("oci_test", ociTestCommand);
bot.command("list_vps", listVpsCommand);

console.log("[BOT] All commands registered successfully");