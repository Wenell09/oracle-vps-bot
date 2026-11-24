import * as oci from "oci-sdk";
import { createComputeClient, createOciAuthenticationProvider } from "./oci-client.js";
import { getVpsConfig } from "../../config/vps.js";
import { getOciConfig } from "../../config/oci.js";

export const PROVISIONING_TAG_KEY = "provisioningJobId";
export const INSTANCE_LIST_LIMIT = 100;
export const MAX_INSTANCE_PAGES = 10;

export const OCI_LIFECYCLE_STATES = {
    PROVISIONING: "PROVISIONING",
    STAGING: "STAGING",
    STARTING: "STARTING",
    RUNNING: "RUNNING",
    STOPPING: "STOPPING",
    STOPPED: "STOPPED",
    CREATING_IMAGE: "CREATING_IMAGE",
    TERMINATING: "TERMINATING",
    TERMINATED: "TERMINATED",
};

export function isInstanceActive(lifecycleState) {
    const activeStates = new Set([
        OCI_LIFECYCLE_STATES.PROVISIONING,
        OCI_LIFECYCLE_STATES.STAGING,
        OCI_LIFECYCLE_STATES.STARTING,
        OCI_LIFECYCLE_STATES.RUNNING,
        OCI_LIFECYCLE_STATES.STOPPING,
        OCI_LIFECYCLE_STATES.STOPPED,
    ]);

    return activeStates.has(lifecycleState);
}

function normalizeInstance(instance, publicIp = null) {
    return {
        id: instance.id,
        displayName: instance.displayName,
        lifecycleState: instance.lifecycleState,
        shape: instance.shape,
        availabilityDomain: instance.availabilityDomain,
        timeCreated: instance.timeCreated,
        publicIp: publicIp || null,
    };
}

export async function findInstanceByProvisioningJobId(
    jobId,
    configOverride = null,
) {
    if (!jobId) {
        throw new Error("Provisioning job ID wajib diisi.");
    }

    const vps = configOverride ?? getVpsConfig();
    const { computeClient } = createComputeClient();

    try {
        let page;

        for (
            let pageNumber = 0;
            pageNumber < MAX_INSTANCE_PAGES;
            pageNumber++
        ) {
            const response = await computeClient.listInstances({
                compartmentId: vps.compartmentId,
                availabilityDomain: vps.availabilityDomain,
                limit: INSTANCE_LIST_LIMIT,
                ...(page ? { page } : {}),
            });

            const instances = response.items ?? [];

            // Filter displayName secara lokal.
            const candidates = instances.filter(
                (instance) =>
                    instance.displayName === vps.displayName &&
                    Boolean(instance.id),
            );

            for (const candidate of candidates) {
                const detailResponse = await computeClient.getInstance({
                    instanceId: candidate.id,
                });

                const instance =
                    detailResponse.instance ?? detailResponse.data;

                if (
                    instance?.freeformTags?.[PROVISIONING_TAG_KEY] === jobId
                ) {
                    console.log(
                        "[OCI RECONCILIATION] Matching instance found:",
                        {
                            jobId,
                            instanceId: instance.id,
                            lifecycleState: instance.lifecycleState,
                        },
                    );

                    return normalizeInstance(instance);
                }
            }

            page = response.opcNextPage;

            if (!page) {
                break;
            }
        }

        console.log(
            "[OCI RECONCILIATION] No matching instance found:",
            { jobId },
        );

        return null;
    } finally {
        if (typeof computeClient.close === "function") {
            await computeClient.close();
        }
    }
}

export async function launchVps(
    opcRetryToken,
    configOverride = null,
    jobId,
) {
    if (!opcRetryToken) {
        throw new Error("OCI retry token wajib diisi.");
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

                freeformTags: {
                    [PROVISIONING_TAG_KEY]: jobId,
                },
            },

            opcRetryToken,
        });

        const instance = response.instance ?? response.data;

        if (!instance?.id) {
            throw new Error(
                "OCI tidak mengembalikan instance OCID. Status provisioning belum dapat dipastikan.",
            );
        }

        console.log("[OCI LAUNCH] Instance created:", {
            jobId,
            instanceId: instance.id,
            lifecycleState: instance.lifecycleState,
        });

        return normalizeInstance(instance);
    } finally {
        if (typeof computeClient.close === "function") {
            await computeClient.close();
        }
    }
}

/**
 * Mendapatkan status terbaru dari OCI untuk sebuah instance.
 */
export async function getInstanceDetails(instanceId) {
    if (!instanceId) {
        throw new Error("Instance ID wajib diisi.");
    }

    const { computeClient } = createComputeClient();

    try {
        const response = await computeClient.getInstance({
            instanceId,
        });

        const instance = response.instance ?? response.data;
        if (!instance) {
            throw new Error(`Instance ${instanceId} tidak ditemukan di OCI.`);
        }

        return normalizeInstance(instance);
    } finally {
        if (typeof computeClient.close === "function") {
            await computeClient.close();
        }
    }
}

/**
 * Mengambil Public IP address dari VNIC instance OCI.
 */
export async function getInstancePublicIp(instanceId, compartmentId) {
    if (!instanceId) {
        throw new Error("Instance ID wajib diisi.");
    }

    const { computeClient, config } = createComputeClient();
    const authProvider = createOciAuthenticationProvider(config);
    const vnetClient = new oci.core.VirtualNetworkClient({
        authenticationDetailsProvider: authProvider,
    });

    try {
        const compId = compartmentId || config.tenancyOCID;
        const vnicAttachmentsResponse = await computeClient.listVnicAttachments({
            compartmentId: compId,
            instanceId,
        });

        const attachments = vnicAttachmentsResponse.items ?? [];
        if (!attachments.length) {
            return null;
        }

        for (const attachment of attachments) {
            if (attachment.lifecycleState === "ATTACHED" && attachment.vnicId) {
                const vnicResponse = await vnetClient.getVnic({
                    vnicId: attachment.vnicId,
                });

                const vnic = vnicResponse.vnic ?? vnicResponse.data;
                if (vnic?.publicIp) {
                    return vnic.publicIp;
                }
            }
        }

        return null;
    } catch (error) {
        console.error("[OCI VNIC] Error fetching public IP:", error.message);
        return null;
    } finally {
        if (typeof computeClient.close === "function") {
            await computeClient.close();
        }
        if (typeof vnetClient.close === "function") {
            await vnetClient.close();
        }
    }
}

/**
 * Menjalankan instance action (START, STOP, SOFTRESET).
 */
export async function performInstanceAction(instanceId, action) {
    if (!instanceId) {
        throw new Error("Instance ID wajib diisi.");
    }

    const allowedActions = ["START", "STOP", "SOFTRESET", "RESET", "SOFTSTOP"];
    const normalizedAction = action.toUpperCase();

    if (!allowedActions.includes(normalizedAction)) {
        throw new Error(`Action tidak valid: ${action}. Harus salah satu dari: ${allowedActions.join(", ")}`);
    }

    const { computeClient } = createComputeClient();

    try {
        const response = await computeClient.instanceAction({
            instanceId,
            action: normalizedAction,
        });

        const instance = response.instance ?? response.data;
        return normalizeInstance(instance);
    } finally {
        if (typeof computeClient.close === "function") {
            await computeClient.close();
        }
    }
}

/**
 * Menghapus/Terminate instance OCI.
 */
export async function terminateVpsInstance(instanceId, preserveBootVolume = false) {
    if (!instanceId) {
        throw new Error("Instance ID wajib diisi.");
    }

    const { computeClient } = createComputeClient();

    try {
        await computeClient.terminateInstance({
            instanceId,
            preserveBootVolume,
        });

        return {
            id: instanceId,
            status: "TERMINATING",
        };
    } finally {
        if (typeof computeClient.close === "function") {
            await computeClient.close();
        }
    }
}
