import { listComputeLimits } from "../services/oci/limits.service.js";

function splitMessage(text, maxLength = 3500) {
    const sections = text.split("\n\n");
    const chunks = [];
    let current = "";

    for (const section of sections) {
        const next = current ? `${current}\n\n${section}` : section;

        if (next.length > maxLength && current) {
            chunks.push(current);
            current = section;
        } else {
            current = next;
        }
    }

    if (current) {
        chunks.push(current);
    }

    return chunks;
}

export async function quotaCheckCommand(ctx) {
    await ctx.reply("Sedang memeriksa Compute quota OCI...");

    try {
        const limits = await listComputeLimits();

        if (!limits.length) {
            return ctx.reply(
                "Tidak ditemukan data Compute limits dari OCI."
            );
        }

        const sections = [
            "COMPUTE QUOTA REPORT",
            `Total limit records: ${limits.length}`,
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
        ];

        const chunks = splitMessage(sections.join("\n\n"));

        for (let i = 0; i < chunks.length; i++) {
            await ctx.reply(chunks[i]);
        }
    } catch (error) {
        console.error("[QUOTA CHECK ERROR]", error);

        await ctx.reply(
            `Gagal mengambil Compute quota OCI.\nError: ${error.message}`
        );
    }
}