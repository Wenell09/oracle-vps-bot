import { listShapes } from "../services/oci/compute.service.js";

export async function listShapesCommand(ctx) {
    console.log("[LIST-SHAPES] Handler started");

    try {
        await ctx.reply("Sedang mengambil daftar VM shapes dari OCI...");

        const shapes = await listShapes();

        if (!shapes.length) {
            await ctx.reply("Tidak ada VM shapes yang ditemukan.");
            return;
        }

        // Prioritaskan Flex shapes untuk eksplorasi,
        // tetapi tetap tampilkan pilihan non-Flex.
        const sortedShapes = [...shapes].sort((a, b) => {
            if (a.isFlexible === b.isFlexible) {
                return a.name.localeCompare(b.name);
            }

            return a.isFlexible ? -1 : 1;
        });

        const limit = 30;
        const selectedShapes = sortedShapes.slice(0, limit);

        const output = selectedShapes.map((shape, index) => {
            return [
                `${index + 1}. ${shape.name}`,
                `Type: ${shape.isFlexible ? "Flex" : "Fixed"}`,
                `OCPU: ${shape.ocpus ?? "-"}`,
                `RAM: ${shape.memoryInGBs ?? "-"} GB`,
                `Network: ${shape.networkingBandwidthInGbps ?? "-"} Gbps`,
                shape.processorDescription
                    ? `CPU: ${shape.processorDescription}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n");
        });

        await ctx.reply(
            [
                "AVAILABLE VM SHAPES",
                "",
                `Total ditemukan: ${shapes.length}`,
                `Ditampilkan: ${selectedShapes.length}`,
                "",
                ...output.flatMap((item) => [item, ""]),
            ].join("\n")
        );

        console.log("[LIST-SHAPES] Success:", {
            total: shapes.length,
            displayed: selectedShapes.length,
        });
    } catch (error) {
        console.error("[LIST-SHAPES] Failed:", {
            message: error.message,
            serviceCode: error.serviceCode,
            statusCode: error.statusCode,
            requestId: error.opcRequestId,
        });

        await ctx.reply(
            [
                "FAILED TO FETCH VM SHAPES",
                "",
                `Error: ${error.serviceCode || error.code || error.message}`,
                `HTTP Status: ${error.statusCode || error.status || "-"}`,
            ].join("\n")
        );
    }
}