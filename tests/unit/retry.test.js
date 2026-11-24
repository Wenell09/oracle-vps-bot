import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    classifyError,
    isRetryableProvisioningError,
    getRetryDelayMinutes,
    RETRY_DELAYS_MINUTES,
    extractErrorCode,
    extractErrorMessage,
} from "../../src/services/oci/retry.service.js";
import { getVpsConfig } from "../../src/config/vps.js";

describe("Retry Service - Error Classification", () => {
    it("should classify OutOfHostCapacity as retryable", () => {
        const error = { serviceCode: "OutOfHostCapacity", message: "Out of host capacity for shape VM.Standard.A1.Flex" };
        const result = classifyError(error);
        assert.equal(result.retryable, true);
        assert.equal(result.category, "OUT_OF_HOST_CAPACITY");
        assert.equal(isRetryableProvisioningError(error), true);
    });

    it("should classify 503 Service Unavailable as retryable", () => {
        const error = { statusCode: 503, message: "Service Unavailable" };
        const result = classifyError(error);
        assert.equal(result.retryable, true);
        assert.equal(result.category, "SERVICE_UNAVAILABLE");
        assert.equal(isRetryableProvisioningError(error), true);
    });

    it("should classify 429 Too Many Requests as retryable", () => {
        const error = { statusCode: 429, message: "Too many requests to OCI API" };
        const result = classifyError(error);
        assert.equal(result.retryable, true);
        assert.equal(result.category, "RATE_LIMITED");
    });

    it("should classify network timeouts as retryable", () => {
        const error = { code: "ETIMEDOUT", message: "Connection timed out" };
        const result = classifyError(error);
        assert.equal(result.retryable, true);
        assert.equal(result.category, "TRANSIENT_NETWORK_ERROR");
    });

    it("should classify 401 Not Authenticated as non-retryable", () => {
        const error = { statusCode: 401, serviceCode: "NotAuthenticated", message: "The required information to complete authentication was not provided." };
        const result = classifyError(error);
        assert.equal(result.retryable, false);
        assert.equal(result.category, "AUTHENTICATION_FAILED");
        assert.equal(isRetryableProvisioningError(error), false);
    });

    it("should classify 403 Not Authorized as non-retryable", () => {
        const error = { statusCode: 403, serviceCode: "NotAuthorizedOrNotFound", message: "Authorization failed or requested resource not found." };
        const result = classifyError(error);
        assert.equal(result.retryable, false);
        assert.equal(result.category, "PERMISSION_DENIED");
    });

    it("should classify QuotaExceeded as non-retryable", () => {
        const error = { serviceCode: "QuotaExceeded", message: "Quota for compute cores exceeded in tenancy" };
        const result = classifyError(error);
        assert.equal(result.retryable, false);
        assert.equal(result.category, "QUOTA_EXCEEDED");
    });

    it("should classify 400 Invalid Parameter as non-retryable", () => {
        const error = { statusCode: 400, serviceCode: "InvalidParameter", message: "Subnet does not exist" };
        const result = classifyError(error);
        assert.equal(result.retryable, false);
        assert.equal(result.category, "INVALID_CONFIGURATION");
    });

    it("should sanitize private keys and credentials from error messages", () => {
        const sensitiveError = {
            message: "Failed with key: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY----- and token=secret123",
        };
        const message = extractErrorMessage(sensitiveError);
        assert.equal(message.includes("MIIEowIBAAKCAQEA"), false);
        assert.equal(message.includes("[REDACTED_KEY]"), true);
        assert.equal(message.includes("token=[REDACTED]"), true);
    });
});

describe("Retry Service - Backoff & Delay Calculation", () => {
    it("should follow deterministic exponential backoff schedule without jitter", () => {
        assert.equal(getRetryDelayMinutes(1, { enableJitter: false }), 1);
        assert.equal(getRetryDelayMinutes(2, { enableJitter: false }), 3);
        assert.equal(getRetryDelayMinutes(3, { enableJitter: false }), 5);
        assert.equal(getRetryDelayMinutes(4, { enableJitter: false }), 10);
        assert.equal(getRetryDelayMinutes(5, { enableJitter: false }), 15);
    });

    it("should cap at max delay for attempt counts exceeding schedule length", () => {
        assert.equal(getRetryDelayMinutes(10, { enableJitter: false }), 15);
        assert.equal(getRetryDelayMinutes(20, { enableJitter: false }), 15);
    });

    it("should add jitter within acceptable bounds when jitter is enabled", () => {
        const delayWithJitter = getRetryDelayMinutes(1, { enableJitter: true, jitterMs: 15000 });
        assert.equal(delayWithJitter, 1.25); // 1 min + 15s / 60s
    });
});

describe("VPS Configuration Validation", () => {
    function setupValidEnv() {
        process.env.OCI_TENANCY_OCID = "ocid1.tenancy.oc1..test";
        process.env.OCI_USER_OCID = "ocid1.user.oc1..test";
        process.env.OCI_FINGERPRINT = "12:34:56:78";
        process.env.OCI_REGION = "ap-batam-1";
        process.env.OCI_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA00000000\n-----END RSA PRIVATE KEY-----";
        process.env.OCI_COMPARTMENT_OCID = "ocid1.compartment.oc1..test";
        process.env.OCI_AVAILABILITY_DOMAIN = "AD-1";
        process.env.OCI_IMAGE_OCID = "ocid1.image.oc1..test";
        process.env.OCI_SUBNET_OCID = "ocid1.subnet.oc1..test";
        process.env.OCI_SSH_PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGo123456789 test@vps";
        process.env.TELEGRAM_ADMIN_ID = "123456";
    }

    it("should validate required variables and reject missing ones", () => {
        const originalEnv = { ...process.env };
        try {
            setupValidEnv();
            delete process.env.OCI_COMPARTMENT_OCID;
            assert.throws(() => getVpsConfig(), /Missing VPS environment variables/);
        } finally {
            process.env = originalEnv;
        }
    });

    it("should reject non-supported SSH public key formats", () => {
        const originalEnv = { ...process.env };
        try {
            setupValidEnv();
            process.env.OCI_SSH_PUBLIC_KEY = "invalid-ssh-key-format";
            assert.throws(() => getVpsConfig(), /harus berupa valid public key/);
        } finally {
            process.env = originalEnv;
        }
    });
});
