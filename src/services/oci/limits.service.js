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
        const limits = [];
        let page;

        // Ambil seluruh halaman limit
        do {
            const response = await limitsClient.listLimitValues({
                compartmentId,
                serviceName: "compute",
                page,
            });

            limits.push(...(response.items ?? []));
            page = response.opcNextPage;
        } while (page);

        const a1Limits = limits.filter((item) =>
            A1_LIMIT_NAMES.includes(item.name)
        );

        console.log("[A1 LIMIT DISCOVERY]", JSON.stringify(
            a1Limits.map((item) => ({
                name: item.name,
                value: item.value,
                scopeType: item.scopeType,
                availabilityDomain: item.availabilityDomain,
            })),
            null,
            2
        ));

        if (a1Limits.length === 0) {
            // Tampilkan nama limit yang mengandung A1 untuk diagnosis
            const candidates = limits
                .filter((item) => item.name?.toLowerCase().includes("a1"))
                .map((item) => ({
                    name: item.name,
                    value: item.value,
                    scopeType: item.scopeType,
                    availabilityDomain: item.availabilityDomain,
                }));

            console.log("[A1 LIMIT CANDIDATES]", candidates);

            throw new Error(
                `A1 quota tidak ditemukan. Total limits: ${limits.length}. ` +
                `A1 candidates: ${JSON.stringify(candidates)}`
            );
        }

        const results = await Promise.all(
            a1Limits.map(async (limit) => {
                if (
                    limit.scopeType === "AD" &&
                    !limit.availabilityDomain
                ) {
                    return {
                        name: limit.name,
                        limit: limit.value,
                        scopeType: limit.scopeType,
                        status: "MISSING_AVAILABILITY_DOMAIN",
                    };
                }

                try {
                    const response =
                        await limitsClient.getResourceAvailability({
                            compartmentId,
                            serviceName: "compute",
                            limitName: limit.name,
                            ...(limit.scopeType === "AD"
                                ? { availabilityDomain: limit.availabilityDomain }
                                : {}),
                        });

                    const availability = response.resourceAvailability;

                    return {
                        name: limit.name,
                        limit: limit.value,
                        scopeType: limit.scopeType,
                        availabilityDomain: limit.availabilityDomain,
                        used: availability?.used,
                        available: availability?.available,
                        fractionalUsed: availability?.fractionalUsed,
                        fractionalAvailable: availability?.fractionalAvailable,
                        status: "SUCCESS",
                    };
                } catch (error) {
                    console.error(
                        `[A1 AVAILABILITY ERROR] ${limit.name}`,
                        error
                    );

                    return {
                        name: limit.name,
                        limit: limit.value,
                        scopeType: limit.scopeType,
                        availabilityDomain: limit.availabilityDomain,
                        status: "QUERY_FAILED",
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