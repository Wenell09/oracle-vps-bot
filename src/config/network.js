export function getNetworkConfig() {
    const requiredVariables = [
        "OCI_VCN_OCID",
        "OCI_SUBNET_OCID",
    ];

    const missingVariables = requiredVariables.filter(
        (key) => !process.env[key]?.trim()
    );

    if (missingVariables.length > 0) {
        throw new Error(
            `Missing network environment variables: ${missingVariables.join(", ")}`
        );
    }

    return {
        vcnId: process.env.OCI_VCN_OCID.trim(),
        subnetId: process.env.OCI_SUBNET_OCID.trim(),
    };
}