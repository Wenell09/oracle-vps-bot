export async function idCommand(ctx) {
    const userId = ctx.from?.id;

    await ctx.reply(
        `Your Telegram User ID: ${userId}`
    );
}