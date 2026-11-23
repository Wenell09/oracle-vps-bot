import { listImages } from "../services/oci/compute.service.js";

export async function listImagesCommand(ctx) {
    await ctx.reply(
        "Sedang mencari Ubuntu image yang kompatibel dengan VM.Standard.A1.Flex..."
    );

    try {
        const images = await listImages();

        if (images.length === 0) {
            return ctx.reply(
                "Tidak ditemukan Ubuntu 24.04 image untuk shape VM.Standard.A1.Flex."
            );
        }

        const activeImages = images.filter(
            (image) => image.lifecycleState === "AVAILABLE"
        );

        const displayedImages = activeImages.slice(0, 10);

        const message = [
            "UBUNTU IMAGES",
            `Total image tersedia: ${activeImages.length}`,
            `Ditampilkan: ${displayedImages.length}`,
            "",
            ...displayedImages.map(
                (image, index) =>
                    [
                        `${index + 1}. ${image.displayName}`,
                        `OS: ${image.operatingSystem} ${image.operatingSystemVersion}`,
                        `State: ${image.lifecycleState}`,
                        `Size: ${image.sizeInMBs ?? "-"} MB`,
                        `Launch Mode: ${image.launchMode ?? "-"}`,
                        `Image OCID: ${image.id}`,
                    ].join("\n")
            ),
        ].join("\n\n");

        await ctx.reply(message);
    } catch (error) {
        console.error("[LIST IMAGES ERROR]", error);

        await ctx.reply(
            `Gagal mengambil Ubuntu image OCI.\nError: ${error.message}`
        );
    }
}