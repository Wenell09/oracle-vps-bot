import * as oci from "oci-sdk";
import { getOciConfig } from "../../config/oci.js";

export function createIdentityClient() {
    const config = getOciConfig();

    const region = oci.common.Region.fromRegionId(
        config.region
    );

    const authenticationProvider =
        new oci.SimpleAuthenticationDetailsProvider(
            config.tenancyOCID,
            config.userOCID,
            config.fingerprint,
            config.privateKey,
            config.passphrase,
            region
        );

    const identityClient = new oci.identity.IdentityClient({
        authenticationDetailsProvider: authenticationProvider,
    });

    return {
        identityClient,
        config,
    };
}