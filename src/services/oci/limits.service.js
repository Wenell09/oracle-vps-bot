import { createLimitsClient } from "./oci-client.js";

const A1_LIMIT_NAMES = [
    "standard-a1-core-count",
    "standard-a1-memory-count",
];

export async function getA1QuotaAvailability() {
    const { limitsClient, config } = createLimitsClient();

    const compartmentId =
        process.env.OCI_COMPARTMENT_OCID?.trim() ||
        config.tenancyOCID;

    try {
        // Ambil metadata limit A1
        const response = await limitsClient.listLimitValues({
            compartmentId,
            serviceName: "compute",
        });

        const a1Limits = (response.items ?? []).filter((item) =>
            A1_LIMIT_NAMES.includes(item.name)
        );

        if (!a1Limits.length) {
            throw new Error("A1 quota tidak ditemukan.");
        }

        const results = await Promise.all(
            a1Limits.map(async (limit) => {
                try {
                    const availabilityResponse =
                        await limitsClient.getResourceAvailability({
                            compartmentId,
                            serviceName: "compute",
                            limitName: limit.name,
                            availabilityDomain: limit.availabilityDomain,
                        });

                    const availability = availabilityResponse.resourceAvailability;

                    return {
                        name: limit.name,
                        limit: limit.value,
                        scopeType: limit.scopeType,
                        availabilityDomain: limit.availabilityDomain,
                        used: availability?.used,
                        available: availability?.available,
                        fractionalUsed: availability?.fractionalUsed,
                        fractionalAvailable: availability?.fractionalAvailable,
                        status: "AVAILABLE",
                    };
                } catch (error) {
                    console.error(
                        `[A1 QUOTA AVAILABILITY ERROR] ${limit.name}`,
                        error
                    );

                    return {
                        name: limit.name,
                        limit: limit.value,
                        scopeType: limit.scopeType,
                        availabilityDomain: limit.availabilityDomain,
                        status: "UNAVAILABLE_TO_QUERY",
                        error: error.message,
                    };
                }
            })
        );

        return results;
    } finally {
        if (typeof limitsClient.close === "function") {
            limitsClient.close();
        }
    }
}