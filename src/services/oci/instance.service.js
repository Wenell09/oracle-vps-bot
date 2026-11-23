
import { createComputeClient } from "./oci-client.js";
import { getVpsConfig } from "../../config/vps.js";

const PROVISIONING_TAG_KEY = "provisioningJobId";

/**
 * Mencari instance yang dibuat oleh provisioning job tertentu.
 *
 * Identitas menggunakan freeformTags.provisioningJobId,
 * bukan displayName, agar tidak salah mengidentifikasi VPS lain.
 */
export async function findInstanceByProvisioningJobId(
    jobId,
    configOverride = null
) {
    if (!jobId) {
        throw new Error("Provisioning job ID wajib diisi.");
    }

    const vps = configOverride ?? getVpsConfig();
    const { computeClient } = createComputeClient();

    try {
        let page;
        const instances = [];

        // Membaca halaman instance OCI.
        // Batasi maksimal 5 halaman (500 instance) untuk menghindari
        // request yang terlalu lama pada serverless worker.
        for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
            const response = await computeClient.listInstances({
                compartmentId: vps.compartmentId,
                availabilityDomain: vps.availabilityDomain,
                limit: 100,
                page,
            });

            const items = response.items ?? response.data ?? [];
            instances.push(...items);

            const nextPage = response.opcNextPage;

            if (!nextPage || items.length === 0) {
                break;
            }

            page = nextPage;
        }

        const matchedInstance = instances.find(
            (instance) =>
                instance.freeformTags?.[PROVISIONING_TAG_KEY] === jobId
        );

        if (!matchedInstance) {
            return null;
        }

        return {
            id: matchedInstance.id,
            displayName: matchedInstance.displayName,
            lifecycleState: matchedInstance.lifecycleState,
            shape: matchedInstance.shape,
            timeCreated: matchedInstance.timeCreated,
        };
    } finally {
        if (typeof computeClient.close === "function") {
            computeClient.close();
        }
    }
}

/**
 * Membuat VPS menggunakan OCI Compute API.
 *
 * retryToken tetap sama untuk setiap retry dari job yang sama.
 * jobId dipasang sebagai freeform tag untuk reconciliation.
 */
export async function launchVps(
    opcRetryToken,
    configOverride = null,
    jobId = null
) {
    if (!opcRetryToken) {
        throw new Error("Provisioning retry token wajib diisi.");
    }

    if (!jobId) {
        throw new Error("Provisioning job ID wajib diisi.");
    }

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

                // Identitas unik untuk rekonsiliasi instance.
                freeformTags: {
                    [PROVISIONING_TAG_KEY]: jobId,
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
