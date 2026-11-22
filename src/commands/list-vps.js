import { listInstances } from "../services/oci/compute.service.js";

export async function listVpsCommand(ctx) {
    console.log("[LIST-VPS] Handler started");

    try {
        await ctx.reply("Sedang mengambil daftar VPS dari Oracle Cloud...");

        const instances = await listInstances();

        if (instances.length === 0) {
            await ctx.reply("Tidak ada instance ditemukan di compartment ini.");
            return;
        }

        const messages = instances.map((instance, index) => {
            return [
                `${index + 1}. ${instance.displayName}`,
                `Status: ${instance.lifecycleState}`,
                `Shape: ${instance.shape}`,
                `AD: ${instance.availabilityDomain}`,
            ].join("\n");
        });

        await ctx.reply(
            [
                "OCI INSTANCES",
                "",
                `Total instance: ${instances.length}`,
                "",
                ...messages.flatMap((message) => [message, ""]),
            ].join("\n")
        );

        console.log("[LIST-VPS] Success:", {
            total: instances.length,
        });
    } catch (error) {
        console.error("[LIST-VPS] Failed:", {
            message: error.message,
            serviceCode: error.serviceCode,
            statusCode: error.statusCode,
            requestId: error.opcRequestId,
        });

        await ctx.reply(
            [
                "FAILED TO FETCH INSTANCES",
                "",
                `Error: ${error.serviceCode || error.code || error.message}`,
                `HTTP Status: ${error.statusCode || error.status || "-"}`,
            ].join("\n")
        );
    }
}