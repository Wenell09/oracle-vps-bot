import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isInstanceActive, OCI_LIFECYCLE_STATES } from "../../src/services/oci/instance.service.js";

describe("Provisioning Lifecycle - Valid Status Transitions", () => {
    const VALID_STATUSES = new Set([
        "PENDING",
        "PROCESSING",
        "RETRYING",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
    ]);

    const ALLOWED_TRANSITIONS = {
        PENDING: ["PROCESSING", "CANCELLED"],
        PROCESSING: ["SUCCEEDED", "RETRYING", "FAILED"],
        RETRYING: ["PROCESSING", "CANCELLED", "FAILED"],
        SUCCEEDED: [], // Terminal state
        FAILED: [],    // Terminal state
        CANCELLED: [], // Terminal state
    };

    function isValidTransition(fromStatus, toStatus) {
        if (!VALID_STATUSES.has(fromStatus) || !VALID_STATUSES.has(toStatus)) {
            return false;
        }
        return ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
    }

    it("should allow PENDING -> PROCESSING", () => {
        assert.equal(isValidTransition("PENDING", "PROCESSING"), true);
    });

    it("should allow PROCESSING -> SUCCEEDED", () => {
        assert.equal(isValidTransition("PROCESSING", "SUCCEEDED"), true);
    });

    it("should allow PROCESSING -> RETRYING", () => {
        assert.equal(isValidTransition("PROCESSING", "RETRYING"), true);
    });

    it("should allow RETRYING -> PROCESSING", () => {
        assert.equal(isValidTransition("RETRYING", "PROCESSING"), true);
    });

    it("should allow PROCESSING -> FAILED", () => {
        assert.equal(isValidTransition("PROCESSING", "FAILED"), true);
    });

    it("should allow PENDING -> CANCELLED and RETRYING -> CANCELLED", () => {
        assert.equal(isValidTransition("PENDING", "CANCELLED"), true);
        assert.equal(isValidTransition("RETRYING", "CANCELLED"), true);
    });

    it("should prevent terminal states (SUCCEEDED, FAILED, CANCELLED) from transitioning back to PROCESSING", () => {
        assert.equal(isValidTransition("SUCCEEDED", "PROCESSING"), false);
        assert.equal(isValidTransition("FAILED", "PROCESSING"), false);
        assert.equal(isValidTransition("CANCELLED", "PROCESSING"), false);
    });
});

describe("OCI Lifecycle States Evaluation", () => {
    it("should identify active instance states", () => {
        assert.equal(isInstanceActive(OCI_LIFECYCLE_STATES.PROVISIONING), true);
        assert.equal(isInstanceActive(OCI_LIFECYCLE_STATES.STARTING), true);
        assert.equal(isInstanceActive(OCI_LIFECYCLE_STATES.RUNNING), true);
        assert.equal(isInstanceActive(OCI_LIFECYCLE_STATES.STOPPING), true);
        assert.equal(isInstanceActive(OCI_LIFECYCLE_STATES.STOPPED), true);
    });

    it("should identify terminated and terminating states as non-active", () => {
        assert.equal(isInstanceActive(OCI_LIFECYCLE_STATES.TERMINATING), false);
        assert.equal(isInstanceActive(OCI_LIFECYCLE_STATES.TERMINATED), false);
        assert.equal(isInstanceActive("UNKNOWN_STATE"), false);
    });
});
