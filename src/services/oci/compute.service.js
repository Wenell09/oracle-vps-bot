import { createComputeClient } from "./oci-client.js";

export async function listInstances() {
    const { computeClient, config } = createComputeClient();

    const compartmentId =
        process.env.OCI_COMPARTMENT_OCID?.trim() ||
        config.tenancyOCID;

    try {
        const response = await computeClient.listInstances({
            compartmentId,
        });

        return response.items.map((instance) => ({
            id: instance.id,
            displayName: instance.displayName,
            shape: instance.shape,
            lifecycleState: instance.lifecycleState,
            availabilityDomain: instance.availabilityDomain,
            region: config.region,
            timeCreated: instance.timeCreated,
        }));
    } finally {
        if (typeof computeClient.close === "function") {
            computeClient.close();
        }
    }
}