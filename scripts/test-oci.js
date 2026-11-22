import "dotenv/config";
import { testOciConnection } from "../src/services/oci/identity.service.js";

async function main() {
    console.log("Testing OCI connection...");
    console.log("Region: ap-batam-1");

    try {
        const result = await testOciConnection();

        console.log("\nOCI CONNECTION SUCCESS");
        console.log("Region:", result.region);
        console.log("Availability Domains:");

        for (const domain of result.availabilityDomains) {
            console.log("-", domain.name);
        }
    } catch (error) {
        console.error("\nOCI CONNECTION FAILED");
        console.error("Message:", error.message);
        console.error("Service Code:", error.serviceCode);
        console.error("HTTP Status:", error.statusCode);

        process.exitCode = 1;
    }
}

main();