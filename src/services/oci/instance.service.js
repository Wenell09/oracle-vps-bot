import { createComputeClient } from "./oci-client.js";
import { getVpsConfig } from "../../config/vps.js";

export async function launchVps(opcRetryToken) {
    if (!opcRetryToken) {
        throw new Error("Provisioning retry token wajib diisi.");
    }

    const vps = getVpsConfig();
    const { computeClient } = createComputeClient();

    try {
        const response = await computeClient.launchInstance({
            launchInstanceDetails: {
                availabilityDomain: vps.availabilityDomain,
                compartmentId: vps.compartmentId,
                displayName: vps.displayName,
                shape: vps.shape,

                shapeConfig: {
                    ocpus: vps.ocpus,
                    memoryInGBs: vps.memoryInGBs,
                },

                sourceDetails: {
                    sourceType: "image",
                    imageId: vps.imageId,
                    bootVolumeSizeInGBs: vps.bootVolumeSizeInGBs,
                },

                createVnicDetails: {
                    subnetId: vps.subnetId,
                    assignPublicIp: true,
                },

                metadata: {
                    ssh_authorized_keys: vps.sshPublicKey,
                },
            },

            opcRetryToken,
        });

        const instance = response.instance ?? response.data;

        return {
            id: instance.id,
            displayName: instance.displayName,
            lifecycleState: instance.lifecycleState,
            shape: instance.shape,
            timeCreated: instance.timeCreated,
        };
    } finally {
        if (typeof computeClient.close === "function") {
            computeClient.close();
        }
    }
}