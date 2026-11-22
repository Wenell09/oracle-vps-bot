import { listImages } from "../services/oci/compute.service.js";

export async function listImagesCommand(ctx) {
    console.log("[LIST-IMAGES] Handler started");

    try {
        await ctx.reply("Sedang mengambil daftar OS images dari OCI...");

        const images = await listImages();

        if (!images.length) {
            await ctx.reply("Tidak ada OS images ditemukan.");
            return;
        }

        const activeImages = images.filter(
            (image) => image.lifecycleState === "AVAILABLE"
        );

        const limit = 8;
        const selectedImages = activeImages.slice(0, limit);

        if (!selectedImages.length) {
            await ctx.reply("Tidak ditemukan OS image dengan status AVAILABLE.");
            return;
        }

        const output = selectedImages.map((image, index) => {
            return [
                `${index + 1}. ${image.displayName}`,
                `OS: ${image.operatingSystem || "-"}`,
                `Version: ${image.operatingSystemVersion || "-"}`,
                `Size: ${image.sizeInMBs ?? "-"} MB`,
                `State: ${image.lifecycleState}`,
                "",
                `Image OCID:`,
                image.id,
            ].join("\n");
        });

        await ctx.reply(
            [
                "AVAILABLE OS IMAGES",
                "",
                `Total image aktif: ${activeImages.length}`,
                `Ditampilkan: ${selectedImages.length}`,
                "",
                ...output.flatMap((item) => [item, ""]),
            ].join("\n")
        );

        console.log("[LIST-IMAGES] Success:", {
            total: images.length,
            active: activeImages.length,
            displayed: selectedImages.length,
        });
    } catch (error) {
        console.error("[LIST-IMAGES] Failed:", {
            message: error.message,
            serviceCode: error.serviceCode,
            statusCode: error.statusCode,
            requestId: error.opcRequestId,
        });

        await ctx.reply(
            [
                "FAILED TO FETCH OS IMAGES",
                "",
                `Error: ${error.serviceCode || error.code || error.message}`,
                `HTTP Status: ${error.statusCode || error.status || "-"}`,
            ].join("\n")
        );
    }
}