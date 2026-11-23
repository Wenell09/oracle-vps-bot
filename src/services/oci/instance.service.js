import { createComputeClient } from "./oci-client.js";
import { getVpsConfig } from "../../config/vps.js";

export async function launchVps(opcRetryToken, configOverride = null) {
    if (!opcRetryToken) {
        throw new Error("Provisioning retry token wajib diisi.");
    }

    // Gunakan snapshot konfigurasi job ketika retry.
    const vps = configOverride ?? getVpsConfig();

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

        if (!instance?.id) {
            throw new Error(
                "OCI tidak mengembalikan instance OCID. Status provisioning belum dapat dipastikan."
            );
        }

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