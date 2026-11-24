import "./config/env.js";
import { Bot } from "grammy";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { pingCommand } from "./commands/ping.js";
import { idCommand } from "./commands/id.js";
import { ociTestCommand } from "./commands/oci-test.js";
import { listVpsCommand } from "./commands/list-vps.js";
import { listShapesCommand } from "./commands/list-shapes.js";
import { listImagesCommand } from "./commands/list-images.js";
import { listVcnsCommand } from "./commands/list-vcns.js";
import { listSubnetsCommand } from "./commands/list-subnets.js";
import { networkCheckCommand } from "./commands/network-check.js";
import { quotaCheckCommand } from "./commands/quota-check.js";
import {
    launchVpsCommand,
    confirmLaunchVps,
    cancelLaunchVps,
} from "./commands/launch-vps.js";
import {
    registerRetryManagementCommands,
} from "./commands/retry-management.js";
import {
    createCommand,
    statusCommand,
    listCommand,
    deleteCommand,
    registerInstanceManagementCallbacks,
} from "./commands/manage-vps.js";
import { recordTelegramUpdate } from "./services/database/provisioning.repository.js";

const token = process.env.TELEGRAM_BOT_TOKEN || "000000000:dummy_token_for_tests";

if (!token && process.env.NODE_ENV !== "test") {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Bot(token);

bot.catch((error) => {
    console.error("[BOT] Error:", error);
});

// 1. Logging middleware
bot.use(async (ctx, next) => {
    console.log("[BOT] Update received:", {
        updateId: ctx.update.update_id,
        userId: ctx.from?.id,
        text: ctx.message?.text,
        chatId: ctx.chat?.id,
        callbackData: ctx.callbackQuery?.data,
    });

    await next();
});

// 2. Telegram Webhook Deduplication Middleware
// Mencegah pemrosesan ganda akibat retry webhook Telegram
bot.use(async (ctx, next) => {
    const updateId = ctx.update?.update_id;

    if (updateId) {
        const isNew = await recordTelegramUpdate(updateId);
        if (!isNew) {
            console.warn(`[BOT DEDUPLICATION] Duplicate update ignored: ${updateId}`);
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery().catch(() => {});
            }
            return;
        }
    }

    await next();
});

// 3. Authorization Middleware
bot.use(async (ctx, next) => {
    const allowedUserId = process.env.ALLOWED_TELEGRAM_USER_ID || process.env.TELEGRAM_ADMIN_ID;
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

        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({
                text: "Unauthorized user.",
                show_alert: true,
            });
        } else {
            await ctx.reply("Unauthorized user.");
        }

        return;
    }

    await next();
});

// 4. Primary VPS Commands
bot.command("start", startCommand);
bot.command("help", helpCommand);
bot.command("create", createCommand);
bot.command("status", statusCommand);
bot.command("list", listCommand);
bot.command("delete", deleteCommand);

// 5. Existing Diagnostic & Utility Commands
bot.command("ping", pingCommand);
bot.command("id", idCommand);
bot.command("oci_test", ociTestCommand);
bot.command("list_vps", listVpsCommand);
bot.command("list_shapes", listShapesCommand);
bot.command("list_images", listImagesCommand);
bot.command("list_vcns", listVcnsCommand);
bot.command("list_subnets", listSubnetsCommand);
bot.command("network_check", networkCheckCommand);
bot.command("quota_check", quotaCheckCommand);
bot.command("launch_vps", launchVpsCommand);

// 6. Callback query handlers for launch VPS
bot.callbackQuery(/^launch_vps:(.+)$/, confirmLaunchVps);
bot.callbackQuery(/^cancel_vps:(.+)$/, cancelLaunchVps);

// 7. Register Retry Management and Instance Management
registerRetryManagementCommands(bot);
registerInstanceManagementCallbacks(bot);

console.log("[BOT] All commands and callbacks registered successfully");
