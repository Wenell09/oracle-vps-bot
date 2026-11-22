export async function startCommand(ctx) {
    const message = `
Welcome to Oracle VPS Bot!

Bot ini membantu mengelola provisioning
Oracle Cloud Infrastructure.

Available commands:

/start - Start bot
/help  - Show help
/ping  - Check bot status
/id    - Show Telegram user ID

Oracle provisioning coming soon.
`;

    await ctx.reply(message);
}