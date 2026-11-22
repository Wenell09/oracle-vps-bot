import { bot } from "./bot.js";

async function main() {
    console.log("Starting Telegram bot...");

    await bot.api.deleteWebhook();

    await bot.start({
        onStart: (botInfo) => {
            console.log(`Bot @${botInfo.username} is running`);
        },
    });
}

main().catch((error) => {
    console.error("Failed to start bot:", error);
    process.exit(1);
});