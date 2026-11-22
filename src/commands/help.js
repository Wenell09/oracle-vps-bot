export async function helpCommand(ctx) {
    await ctx.reply(`
Available Commands:

/start - Start bot
/help  - Show help
/ping  - Check connection
/id    - Get Telegram user ID
`);
}