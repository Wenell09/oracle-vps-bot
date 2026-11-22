import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
}

const response = await fetch(
    `https://api.telegram.org/bot${token}/deleteWebhook`,
    {
        method: "POST",
    }
);

const result = await response.json();
