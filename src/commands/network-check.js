import { checkNetworkReadiness } from "../services/oci/network.service.js";

export async function networkCheckCommand(ctx) {
    await ctx.reply("Sedang memeriksa kesiapan jaringan OCI...");

    try {
        const result = await checkNetworkReadiness();

        const statusIcon = (passed) =>
            passed ? "✅" : "❌";

        const checkMessages = result.checks
            .map(
                (check) =>
                    `${statusIcon(check.passed)} ${check.name}\n   ${check.detail}`
            )
            .join("\n\n");

        const overallStatus = result.ready
            ? "✅ NETWORK READY"
            : "❌ NETWORK NOT READY";

        const message = [
            "🌐 NETWORK READINESS CHECK",
            "",
            `VCN: ${result.vcn.name}`,
            `Subnet: ${result.subnet.name}`,
            `CIDR: ${result.subnet.cidrBlock}`,
            "",
            checkMessages,
            "",
            "────────────────────",
            overallStatus,
        ].join("\n");

        await ctx.reply(message);
    } catch (error) {
        console.error("[NETWORK CHECK ERROR]", error);

        await ctx.reply(
            [
                "❌ NETWORK CHECK FAILED",
                "",
                "Gagal memeriksa konfigurasi jaringan OCI.",
                "",
                `Error: ${error.message}`,
                "",
                "Periksa konfigurasi OCID dan permission OCI API.",
            ].join("\n")
        );
    }
}