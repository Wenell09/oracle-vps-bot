import { createLimitsClient } from "./oci-client.js";

export async function listComputeLimits() {
    const { limitsClient, config } = createLimitsClient();

    const compartmentId =
        process.env.OCI_COMPARTMENT_OCID?.trim() || config.tenancyOCID;

    const limits = [];
    let page;

    try {
        do {
            const response = await limitsClient.listLimitValues({
                compartmentId,
                serviceName: "compute",
                page,
            });

            limits.push(...(response.items ?? []));
            page = response.opcNextPage;
        } while (page);

        return limits.map((item) => ({
            name: item.name,
            value: item.value,
            used: item.used,
            available: item.available,
            scopeType: item.scopeType,
            scope: item.scope,
            compartmentId: item.compartmentId,
        }));
    } finally {
        if (typeof limitsClient.close === "function") {
            limitsClient.close();
        }
    }
}