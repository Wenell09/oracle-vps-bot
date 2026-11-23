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
/oci_test    - test connection OCI
/list_vps    - List OCI instances
/list_shapes    - List available VM shapes
/list_images    - List available OS images
/list_vcns    - List OCI virtual cloud networks
/list_subnets    - List OCI subnets
/network_check    - Check OCI network readiness
/quota_check - check compute quota
/launch_vps - Create VPS

`;

    await ctx.reply(message);
}