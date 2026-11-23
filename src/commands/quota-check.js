import { getA1QuotaAvailability } from "../services/oci/limits.service.js";

const A1_LIMITS = {
    "standard-a1-core-count": {
        label: "A1 OCPU",
        unit: "OCPU",
        required: 1,
    },
    "standard-a1-memory-count": {
        label: "A1 Memory",
        unit: "GB",
        required: 6,
    },
};

export async function quotaCheckCommand(ctx) {
    await ctx.reply("Sedang memeriksa A1 Compute quota OCI...");

    try {
        const results = await getA1QuotaAvailability();

        const sections = [
            "A1 COMPUTE QUOTA",
            "",
        ];

        for (const result of results) {
            const metadata = A1_LIMITS[result.name];

            if (!metadata) continue;

            sections.push(
                [
                    metadata.label,
                    `Required: ${metadata.required} ${metadata.unit}`,
                    `Limit: ${result.limit ?? "-"}`,
                    `Used: ${result.used ?? "-"}`,
                    `Available: ${result.available ?? "-"}`,
                    `AD: ${result.availabilityDomain ?? "-"}`,
                    `Status: ${result.status}`,
                ].join("\n")
            );
        }

        await ctx.reply(sections.join("\n\n"));
    } catch (error) {
        console.error("[QUOTA CHECK ERROR]", error);

        await ctx.reply(
            `Gagal memeriksa A1 quota.\nError: ${error.message}`
        );
    }
}