import { testOciConnection } from "../services/oci/identity.service.js";

export async function ociTestCommand(ctx) {
    console.log("[OCI-TEST] Handler started");

    try {
        await ctx.reply("Sedang menguji koneksi ke Oracle Cloud...");

        const result = await testOciConnection();

        const domains = result.availabilityDomains
            .map((item) => `- ${item.name}`)
            .join("\n");

        await ctx.reply(
            [
                "OCI CONNECTION SUCCESS",
                "",
                `Region: ${result.region}`,
                "Authentication: Successful",
                "",
                "Availability Domains:",
                domains || "Tidak ada Availability Domain ditemukan.",
            ].join("\n")
        );

        console.log("[OCI-TEST] Success");
    } catch (error) {
        console.error("[OCI-TEST] Failed:", {
            message: error.message,
            serviceCode: error.serviceCode,
            statusCode: error.statusCode,
            requestId: error.opcRequestId,
        });

        await ctx.reply(
            [
                "OCI CONNECTION FAILED",
                "",
                `Error: ${error.serviceCode || error.code || error.message}`,
                `HTTP Status: ${error.statusCode || error.status || "-"}`,
            ].join("\n")
        );
    }
}