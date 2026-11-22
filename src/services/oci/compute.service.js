import { createComputeClient } from "./oci-client.js";

function getCompartmentId(config) {
    return (
        process.env.OCI_COMPARTMENT_OCID?.trim() ||
        config.tenancyOCID
    );
}

export async function listInstances() {
    const { computeClient, config } = createComputeClient();
    const compartmentId = getCompartmentId(config);

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

/**
 * Get available VM shapes in the configured compartment.
 */
export async function listShapes() {
    const { computeClient, config } = createComputeClient();
    const compartmentId = getCompartmentId(config);

    try {
        const response = await computeClient.listShapes({
            compartmentId,
        });

        return response.items.map((shape) => ({
            name: shape.shape,
            ocpus: shape.ocpus,
            memoryInGBs: shape.memoryInGBs,
            isFlexible: shape.isFlexible,
            processorDescription: shape.processorDescription,
            networkingBandwidthInGbps: shape.networkingBandwidthInGbps,
        }));
    } finally {
        if (typeof computeClient.close === "function") {
            computeClient.close();
        }
    }
}

/**
 * Get available OS images in the configured compartment.
 */
export async function listImages() {
    const { computeClient, config } = createComputeClient();
    const compartmentId = getCompartmentId(config);

    try {
        const response = await computeClient.listImages({
            compartmentId,
        });

        return response.items.map((image) => ({
            id: image.id,
            displayName: image.displayName,
            operatingSystem: image.operatingSystem,
            operatingSystemVersion: image.operatingSystemVersion,
            lifecycleState: image.lifecycleState,
            sizeInMBs: image.sizeInMBs,
        }));
    } finally {
        if (typeof computeClient.close === "function") {
            computeClient.close();
        }
    }
}