
import * as oci from "oci-sdk";
import { getOciConfig } from "../../config/oci.js";
import { createOciAuthenticationProvider } from "./oci-client.js";

function getCompartmentId(config) {
    return (
        process.env.OCI_COMPARTMENT_OCID?.trim() ||
        config.tenancyOCID
    );
}

function createNetworkClient() {
    const config = getOciConfig();
    const authenticationProvider =
        createOciAuthenticationProvider(config);

    const client = new oci.core.VirtualNetworkClient({
        authenticationDetailsProvider: authenticationProvider,
    });

    return {
        client,
        config,
        compartmentId: getCompartmentId(config),
    };
}

export async function listVcns() {
    const { client, compartmentId } = createNetworkClient();

    try {
        const response = await client.listVcns({
            compartmentId,
        });

        return response.items.map((vcn) => ({
            id: vcn.id,
            displayName: vcn.displayName,
            cidrBlocks: vcn.cidrBlocks,
            dnsLabel: vcn.dnsLabel,
            lifecycleState: vcn.lifecycleState,
            defaultRouteTableId: vcn.defaultRouteTableId,
            defaultSecurityListId: vcn.defaultSecurityListId,
        }));
    } finally {
        if (typeof client.close === "function") {
            client.close();
        }
    }
}

export async function listSubnets(vcnId = undefined) {
    const { client, compartmentId } = createNetworkClient();

    try {
        const response = await client.listSubnets({
            compartmentId,
            vcnId,
        });

        return response.items.map((subnet) => ({
            id: subnet.id,
            displayName: subnet.displayName,
            vcnId: subnet.vcnId,
            cidrBlock: subnet.cidrBlock,
            availabilityDomain: subnet.availabilityDomain,
            subnetType: subnet.subnetType,
            prohibitPublicIpOnVnic: subnet.prohibitPublicIpOnVnic,
            routeTableId: subnet.routeTableId,
            securityListIds: subnet.securityListIds,
            lifecycleState: subnet.lifecycleState,
        }));
    } finally {
        if (typeof client.close === "function") {
            client.close();
        }
    }
}
