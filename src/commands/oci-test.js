
import { testOciConnection } from "../services/oci/identity.service.js";

export function registerOciTestCommand(bot) {
    bot.command("oci-test", async (ctx) => {
        console.log("[OCI-TEST] Handler started");

        try {
            await ctx.reply(
                "Sedang menguji koneksi ke Oracle Cloud..."
            );

            console.log("[OCI-TEST] Starting OCI connection");

            const result = await testOciConnection();

            console.log("[OCI-TEST] OCI result:", {
                success: result.success,
                region: result.region,
                domainsCount: result.availabilityDomains.length,
            });

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

            console.log("[OCI-TEST] Response sent");
        } catch (error) {
            console.error("[OCI-TEST] Error:", {
                message: error.message,
                serviceCode: error.serviceCode,
                statusCode: error.statusCode,
                requestId: error.opcRequestId,
                stack: error.stack,
            });

            try {
                await ctx.reply(
                    [
                        "OCI CONNECTION FAILED",
                        "",
                        `Error: ${error.serviceCode || error.code || error.message}`,
                        `HTTP Status: ${error.statusCode || error.status || "-"}`,
                    ].join("\n")
                );
            } catch (replyError) {
                console.error("[OCI-TEST] Telegram reply failed:", {
                    message: replyError.message,
                    description: replyError.description,
                });
            }
        }
    });
}
