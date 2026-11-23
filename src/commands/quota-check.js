import { listComputeLimits } from "../services/oci/limits.service.js";

export async function quotaCheckCommand(ctx) {
    await ctx.reply("Sedang memeriksa Compute quota OCI...");

    try {
        const limits = await listComputeLimits();

        if (!limits.length) {
            return ctx.reply(
                "Tidak ditemukan data Compute limits dari OCI."
            );
        }

        const message = [
            "COMPUTE QUOTA REPORT",
            `Total limit records: ${limits.length}`,
            "",
            ...limits.map((item, index) =>
                [
                    `${index + 1}. ${item.name}`,
                    `Limit: ${item.value ?? "-"}`,
                    `Used: ${item.used ?? "-"}`,
                    `Available: ${item.available ?? "-"}`,
                    `Scope: ${item.scope ?? "-"}`,
                    `Scope Type: ${item.scopeType ?? "-"}`,
                ].join("\n")
            ),
        ].join("\n\n");

        await ctx.reply(message);
    } catch (error) {
        console.error("[QUOTA CHECK ERROR]", error);

        await ctx.reply(
            `Gagal mengambil Compute quota OCI.\nError: ${error.message}`
        );
    }
}