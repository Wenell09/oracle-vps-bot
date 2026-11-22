
import { listVcns } from "../services/oci/network.service.js";

export async function listVcnsCommand(ctx) {
    console.log("[LIST-VCNS] Handler started");

    try {
        await ctx.reply("Sedang mengambil daftar VCN dari OCI...");

        const vcns = await listVcns();

        if (!vcns.length) {
            await ctx.reply(
                "Tidak ada VCN ditemukan. VPS membutuhkan VCN dan subnet untuk konfigurasi network."
            );
            return;
        }

        const output = vcns.map((vcn, index) => {
            return [
                `${index + 1}. ${vcn.displayName}`,
                `State: ${vcn.lifecycleState}`,
                `CIDR: ${vcn.cidrBlocks?.join(", ") || "-"}`,
                `DNS Label: ${vcn.dnsLabel || "-"}`,
                "",
                `VCN OCID:`,
                vcn.id,
                "",
                `Default Route Table OCID:`,
                vcn.defaultRouteTableId || "-",
                "",
                `Default Security List OCID:`,
                vcn.defaultSecurityListId || "-",
            ].join("\n");
        });

        await ctx.reply(
            [
                "OCI VIRTUAL CLOUD NETWORKS",
                "",
                `Total VCN: ${vcns.length}`,
                "",
                ...output.flatMap((item) => [item, ""]),
            ].join("\n")
        );

        console.log("[LIST-VCNS] Success:", {
            total: vcns.length,
        });
    } catch (error) {
        console.error("[LIST-VCNS] Failed:", {
            message: error.message,
            serviceCode: error.serviceCode,
            statusCode: error.statusCode,
            requestId: error.opcRequestId,
        });

        await ctx.reply(
            [
                "FAILED TO FETCH VCNS",
                "",
                `Error: ${error.serviceCode || error.code || error.message}`,
                `HTTP Status: ${error.statusCode || error.status || "-"}`,
            ].join("\n")
        );
    }
}
