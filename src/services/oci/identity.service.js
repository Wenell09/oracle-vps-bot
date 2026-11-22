import { createIdentityClient } from "./oci-client.js";

export async function testOciConnection() {
    const { identityClient, config } = createIdentityClient();

    try {
        const response =
            await identityClient.listAvailabilityDomains({
                compartmentId: config.tenancyOCID,
            });

        return {
            success: true,
            region: config.region,
            availabilityDomains: response.items.map((item) => ({
                name: item.name,
                id: item.id,
            })),
        };
    } finally {
        identityClient.close();
    }
}