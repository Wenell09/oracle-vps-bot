import { getOciConfig } from "./oci.js";

export function getVpsConfig() {
    const requiredVariables = [
        "OCI_COMPARTMENT_OCID",
        "OCI_AVAILABILITY_DOMAIN",
        "OCI_IMAGE_OCID",
        "OCI_SUBNET_OCID",
        "OCI_SSH_PUBLIC_KEY",
        "TELEGRAM_ADMIN_ID",
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

    const sshPublicKey = process.env.OCI_SSH_PUBLIC_KEY.trim();

    if (!sshPublicKey.startsWith("ssh-ed25519 ")) {
        throw new Error("OCI_SSH_PUBLIC_KEY harus berupa ED25519 public key.");
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
    };
}