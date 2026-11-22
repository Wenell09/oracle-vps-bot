import * as oci from "oci-sdk";
import { getOciConfig } from "../../config/oci.js";

export function createOciAuthenticationProvider(config) {
    const region = oci.common.Region.fromRegionId(config.region);

    return new oci.SimpleAuthenticationDetailsProvider(
        config.tenancyOCID,
        config.userOCID,
        config.fingerprint,
        config.privateKey,
        config.passphrase,
        region
    );
}

export function createIdentityClient() {
    const config = getOciConfig();
    const authenticationProvider = createOciAuthenticationProvider(config);

    const identityClient = new oci.identity.IdentityClient({
        authenticationDetailsProvider: authenticationProvider,
    });

    return {
        identityClient,
        config,
    };
}

export function createComputeClient() {
    const config = getOciConfig();
    const authenticationProvider = createOciAuthenticationProvider(config);

    const computeClient = new oci.core.ComputeClient({
        authenticationDetailsProvider: authenticationProvider,
    });

    return {
        computeClient,
        config,
    };
}