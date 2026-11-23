import { listComputeLimits } from "../services/oci/limits.service.js";

const A1_LIMITS = {
    "standard-a1-core-count": {
        label: "A1 OCPU",
        unit: "OCPU",
    },
    "standard-a1-memory-count": {
        label: "A1 Memory",
        unit: "GB",
    },
};

export async function quotaCheckCommand(ctx) {
    await ctx.reply("Sedang memeriksa A1 Compute quota OCI...");

    try {
        const limits = await listComputeLimits();

        const a1Limits = limits.filter((item =>
            Object.hasOwn(A1_LIMITS, item.name)
        ));

        if (a1Limits.length === 0) {
            return ctx.reply(
                [
                    "A1 QUOTA NOT FOUND",
                    "",
                    "Limit A1 tidak ditemukan dari OCI API.",
                    "Periksa scope atau data limit yang dikembalikan OCI.",
                ].join("\n")
            );
        }

        const sections = [
            "A1 COMPUTE QUOTA",
            `Records found: ${a1Limits.length}`,
            "",
            ...a1Limits.map((item) => {
                const metadata = A1_LIMITS[item.name];

                return [
                    metadata.label,
                    `Limit: ${item.value ?? "-"} ${metadata.unit}`,
                    `Used: ${item.used ?? "-"} ${metadata.unit}`,
                    `Available: ${item.available ?? "-"} ${metadata.unit}`,
                    `Scope: ${item.scope ?? "-"}`,
                    `Scope Type: ${item.scopeType ?? "-"}`,
                ].join("\n");
            }),
        ];

        await ctx.reply(sections.join("\n\n"));
    } catch (error) {
        console.error("[QUOTA CHECK ERROR]", error);

        await ctx.reply(
            `Gagal mengambil A1 quota OCI.\nError: ${error.message}`
        );
    }
}