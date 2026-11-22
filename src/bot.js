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

// OCI test command (temporary direct implementation)
bot.command("oci-test", async (ctx) => {
    console.log("[OCI-TEST] Direct handler started");
    try {
        await ctx.reply("Sedang menguji koneksi ke Oracle Cloud...");
        console.log("[OCI-TEST] Starting OCI connection");
        const result = await testOciConnection();
        console.log("[OCI-TEST] Connection successful:", {
            region: result.region,
            domainsCount: result.availabilityDomains.length,
        });
        const domains = result.availabilityDomains
            .map((item) => `- ${item.name}`)
            .join("\n");
        await ctx.reply(
            [
                "OCI CONNECTION SUCCESS",
                "",
                `Region: ${result.region}`,
                "Authentication: Successful",
                "",
                "Availability Domains:",
                domains || "Tidak ada Availability Domain ditemukan.",
            ].join("\n")
        );
        console.log("[OCI-TEST] Response sent");
    } catch (error) {
        console.error("[OCI-TEST] Connection failed:", {
            message: error.message,
            serviceCode: error.serviceCode,
            statusCode: error.statusCode,
            requestId: error.opcRequestId,
            stack: error.stack,
        });
        try {
            await ctx.reply(
                [
                    "OCI CONNECTION FAILED",
                    "",
                    `Error: ${error.serviceCode || error.code || error.message}`,
                    `HTTP Status: ${error.statusCode || error.status || "-"}`,
                ].join("\n")
            );
        } catch (replyError) {
            console.error("[OCI-TEST] Telegram reply failed:", {
                message: replyError.message,
                description: replyError.description,
            });
        }
    }
});

console.log("[BOT] All commands registered successfully");
