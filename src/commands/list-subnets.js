
import { listSubnets } from "../services/oci/network.service.js";

export async function listSubnetsCommand(ctx) {
    console.log("[LIST-SUBNETS] Handler started");

    try {
        await ctx.reply("Sedang mengambil daftar subnet dari OCI...");

        const subnets = await listSubnets();

        if (!subnets.length) {
            await ctx.reply(
                "Tidak ada subnet ditemukan. Kita perlu subnet sebelum provisioning VPS."
            );
            return;
        }

        const output = subnets.map((subnet, index) => {
            const publicIpAllowed = !subnet.prohibitPublicIpOnVnic;

            return [
                `${index + 1}. ${subnet.displayName}`,
                `State: ${subnet.lifecycleState}`,
                `CIDR: ${subnet.cidrBlock}`,
                `Type: ${subnet.subnetType}`,
                `Public IP Allowed: ${publicIpAllowed ? "YES" : "NO"}`,
                `Availability Domain: ${subnet.availabilityDomain || "Regional"}`,
                "",
                `Subnet OCID:`,
                subnet.id,
                "",
                `VCN OCID:`,
                subnet.vcnId,
                "",
                `Route Table OCID:`,
                subnet.routeTableId,
            ].join("\n");
        });

        await ctx.reply(
            [
                "OCI SUBNETS",
                "",
                `Total subnet: ${subnets.length}`,
                "",
                ...output.flatMap((item) => [item, ""]),
            ].join("\n")
        );

        console.log("[LIST-SUBNETS] Success:", {
            total: subnets.length,
        });
    } catch (error) {
        console.error("[LIST-SUBNETS] Failed:", {
            message: error.message,
            serviceCode: error.serviceCode,
            statusCode: error.statusCode,
            requestId: error.opcRequestId,
        });

        await ctx.reply(
            [
                "FAILED TO FETCH SUBNETS",
                "",
                `Error: ${error.serviceCode || error.code || error.message}`,
                `HTTP Status: ${error.statusCode || error.status || "-"}`,
            ].join("\n")
        );
    }
}
