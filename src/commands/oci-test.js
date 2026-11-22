import { testOciConnection } from "../services/oci/identity.service.js";

export function registerOciTestCommand(bot) {
    bot.command("oci-test", async (ctx) => {
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
        } catch (error) {
            console.error("OCI connection failed:", {
                message: error.message,
                serviceCode: error.serviceCode,
                statusCode: error.statusCode,
                requestId: error.opcRequestId,
            });

            const code = error.serviceCode || error.code || "UNKNOWN";
            const status = error.statusCode || error.status || "-";

            await ctx.reply(
                [
                    "OCI CONNECTION FAILED",
                    "",
                    `Error: ${code}`,
                    `HTTP Status: ${status}`,
                    "Silakan periksa konfigurasi dan OCI Runtime Logs.",
                ].join("\n")
            );
        }
    });
}