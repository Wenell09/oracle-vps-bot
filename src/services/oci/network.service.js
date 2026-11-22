import * as oci from "oci-sdk";
import { getOciConfig } from "../../config/oci.js";
import { getNetworkConfig } from "../../config/network.js";
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

function closeClient(client) {
    if (typeof client.close === "function") {
        client.close();
    }
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
        closeClient(client);
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
        closeClient(client);
    }
}

function isPortAllowed(rule, port) {
    if (rule.protocol === "all") {
        return true;
    }

    if (rule.protocol !== "6") {
        return false;
    }

    const range = rule.tcpOptions?.destinationPortRange;

    if (!range) {
        return true;
    }

    return range.min <= port && range.max >= port;
}

function hasDefaultInternetEgress(rules) {
    return rules.some(
        (rule) =>
            rule.destination === "0.0.0.0/0" &&
            rule.protocol === "all"
    );
}

function inspectSshIngress(rules) {
    const sshRules = rules.filter(
        (rule) =>
            rule.source &&
            isPortAllowed(rule, 22)
    );

    const openToWorld = sshRules.some(
        (rule) =>
            rule.source === "0.0.0.0/0" ||
            rule.source === "::/0"
    );

    return {
        allowed: sshRules.length > 0 && !openToWorld,
        openToWorld,
        sources: sshRules.map((rule) => rule.source),
    };
}

export async function checkNetworkReadiness() {
    const { client, compartmentId } = createNetworkClient();
    const { vcnId, subnetId } = getNetworkConfig();

    const checks = [];

    const addCheck = (name, passed, detail) => {
        checks.push({
            name,
            passed,
            detail,
        });
    };

    try {
        // 1. Get VCN
        const vcnResponse = await client.getVcn({
            vcnId,
        });

        const vcn = vcnResponse.vcn;

        addCheck(
            "VCN",
            vcn.lifecycleState === "AVAILABLE",
            `${vcn.displayName}: ${vcn.lifecycleState}`
        );

        // 2. Get subnet
        const subnetResponse = await client.getSubnet({
            subnetId,
        });

        const subnet = subnetResponse.subnet;

        const subnetAvailable =
            subnet.lifecycleState === "AVAILABLE";

        const subnetBelongsToVcn =
            subnet.vcnId === vcnId;

        const publicIpAllowed =
            subnet.prohibitPublicIpOnVnic === false;

        addCheck(
            "Subnet",
            subnetAvailable && subnetBelongsToVcn,
            `${subnet.displayName}: ${subnet.lifecycleState}`
        );

        addCheck(
            "Public IP",
            publicIpAllowed,
            publicIpAllowed
                ? "Public IP assignment is allowed"
                : "Subnet prohibits public IP assignment"
        );

        // 3. Get Internet Gateway
        const gatewayResponse =
            await client.listInternetGateways({
                compartmentId,
                vcnId,
            });

        const internetGateway =
            gatewayResponse.items.find(
                (gateway) =>
                    gateway.lifecycleState === "AVAILABLE" &&
                    gateway.isEnabled
            );

        addCheck(
            "Internet Gateway",
            Boolean(internetGateway),
            internetGateway
                ? `${internetGateway.displayName}: ENABLED`
                : "No enabled Internet Gateway found"
        );

        // 4. Get route table used by subnet
        const routeTableResponse =
            await client.getRouteTable({
                rtId: subnet.routeTableId,
            });

        const routeTable = routeTableResponse.routeTable;
        const routeRules = routeTable.routeRules || [];

        const internetRoute = internetGateway
            ? routeRules.find(
                (rule) =>
                    rule.destination === "0.0.0.0/0" &&
                    rule.networkEntityId === internetGateway.id
            )
            : undefined;

        addCheck(
            "Route Table",
            Boolean(internetRoute),
            internetRoute
                ? "0.0.0.0/0 points to Internet Gateway"
                : "Default internet route not found"
        );

        // 5. Get Security Lists attached to subnet
        const securityListIds =
            subnet.securityListIds || [];

        const securityLists = [];

        for (const securityListId of securityListIds) {
            const response = await client.getSecurityList({
                securityListId,
            });

            securityLists.push(response.securityList);
        }

        const ingressRules = securityLists.flatMap(
            (securityList) =>
                securityList.ingressSecurityRules || []
        );

        const egressRules = securityLists.flatMap(
            (securityList) =>
                securityList.egressSecurityRules || []
        );

        // 6. Check SSH
        const ssh = inspectSshIngress(ingressRules);

        addCheck(
            "SSH Ingress",
            ssh.allowed,
            ssh.openToWorld
                ? "SSH is exposed to the entire internet. Restrict its source CIDR."
                : ssh.allowed
                    ? `SSH allowed from: ${ssh.sources.join(", ")}`
                    : "Restricted SSH TCP/22 ingress rule not found"
        );

        // 7. Check outbound internet
        const egressReady =
            hasDefaultInternetEgress(egressRules);

        addCheck(
            "Egress",
            egressReady,
            egressReady
                ? "Outbound internet traffic is allowed"
                : "All-protocol egress to 0.0.0.0/0 not found"
        );

        return {
            ready: checks.every((check) => check.passed),
            vcn: {
                id: vcn.id,
                name: vcn.displayName,
                state: vcn.lifecycleState,
            },
            subnet: {
                id: subnet.id,
                name: subnet.displayName,
                cidrBlock: subnet.cidrBlock,
                state: subnet.lifecycleState,
            },
            checks,
        };
    } finally {
        closeClient(client);
    }
}