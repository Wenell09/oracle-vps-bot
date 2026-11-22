export async function helpCommand(ctx) {
    await ctx.reply(`
Available Commands:

/start - Start bot
/help  - Show help
/ping  - Check connection
/id    - Get Telegram user ID
/oci_test    - test connection OCI
/list_vps    - List OCI instances
/list_shapes    - List available VM shapes
/list_images    - List available OS images
/list_vcns    - List OCI virtual cloud networks
/list_subnets    - List OCI subnets
/network_check    - Check OCI network readiness
`);
}