import { getOciConfig } from "./oci.js";

export function getVpsConfig() {
    const requiredVariables = [
        "OCI_COMPARTMENT_OCID",
        "OCI_AVAILABILITY_DOMAIN",
        "OCI_IMAGE_OCID",
        "OCI_SUBNET_OCID",
        "OCI_SSH_PUBLIC_KEY",
    ];

    const ociConfig = getOciConfig();

    const missingVariables = requiredVariables.filter(
        (key) => !process.env[key]?.trim()
    );

    if (missingVariables.length > 0) {
        throw new Error(
            `Missing VPS environment variables: ${missingVariables.join(", ")}`
        );
    }

    const adminId = process.env.TELEGRAM_ADMIN_ID?.trim() || process.env.ALLOWED_TELEGRAM_USER_ID?.trim();
    if (!adminId) {
        throw new Error("TELEGRAM_ADMIN_ID or ALLOWED_TELEGRAM_USER_ID must be configured.");
    }

    const sshPublicKey = process.env.OCI_SSH_PUBLIC_KEY.trim();

    if (!sshPublicKey.startsWith("ssh-ed25519 ") && !sshPublicKey.startsWith("ssh-rsa ")) {
        throw new Error("OCI_SSH_PUBLIC_KEY harus berupa valid public key (ssh-ed25519 atau ssh-rsa).");
    }

    return {
        compartmentId:
            process.env.OCI_COMPARTMENT_OCID?.trim() ||
            ociConfig.tenancyOCID,
        availabilityDomain: process.env.OCI_AVAILABILITY_DOMAIN.trim(),
        imageId: process.env.OCI_IMAGE_OCID.trim(),
        subnetId: process.env.OCI_SUBNET_OCID.trim(),
        sshPublicKey,
        displayName:
            process.env.OCI_VPS_DISPLAY_NAME?.trim() || "oracle-vps-01",
        shape: "VM.Standard.A1.Flex",
        ocpus: 1,
        memoryInGBs: 6,
        bootVolumeSizeInGBs: 50,
        adminId,
    };
}
