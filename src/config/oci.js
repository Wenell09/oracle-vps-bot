const requiredVariables = [
    "OCI_TENANCY_OCID",
    "OCI_USER_OCID",
    "OCI_FINGERPRINT",
    "OCI_REGION",
    "OCI_PRIVATE_KEY",
];

export function getOciConfig() {
    const missingVariables = requiredVariables.filter(
        (key) => !process.env[key]?.trim()
    );

    if (missingVariables.length > 0) {
        throw new Error(
            `Missing OCI environment variables: ${missingVariables.join(", ")}`
        );
    }
    const privateKey = process.env.OCI_PRIVATE_KEY
        .replace(/\\n/g, "\n")
        .trim();

    const isValidPem =
        /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(privateKey) &&
        /-----END (?:RSA )?PRIVATE KEY-----/.test(privateKey);

    if (!isValidPem) {
        throw new Error(
            "OCI_PRIVATE_KEY must contain a valid PEM private key"
        );
    }

    return {
        tenancyOCID: process.env.OCI_TENANCY_OCID.trim(),
        userOCID: process.env.OCI_USER_OCID.trim(),
        fingerprint: process.env.OCI_FINGERPRINT.trim(),
        region: process.env.OCI_REGION.trim(),
        privateKey,
        passphrase:
            process.env.OCI_PRIVATE_KEY_PASSPHRASE || null,
    };
}