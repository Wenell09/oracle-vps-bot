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

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Bot(token);

bot.catch((error) => {
    console.error("[BOT] Error:", error);
});

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

bot.use(async (ctx, next) => {
    const allowedUserId = process.env.ALLOWED_TELEGRAM_USER_ID;
    const receivedUserId = String(ctx.from?.id ?? "");

    const isAuthorized =
        !allowedUserId ||
        receivedUserId === String(allowedUserId).trim();

    console.log("[AUTH] Authorization check:", {
        receivedUserId,
        allowedUserId: allowedUserId
            ? "CONFIGURED"
            : "NOT_CONFIGURED",
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

bot.command("start", startCommand);
bot.command("help", helpCommand);
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

bot.callbackQuery(/^launch_vps:(.+)$/, confirmLaunchVps);
bot.callbackQuery(/^cancel_vps:(.+)$/, cancelLaunchVps);

registerRetryManagementCommands(bot);

console.log("[BOT] All commands registered successfully");
