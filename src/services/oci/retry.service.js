import {
    scheduleProvisioningRetry,
    markProvisioningFailed,
} from "../database/provisioning.repository.js";

export const RETRY_DELAYS_MINUTES = [1, 3, 5, 10, 15];

export const RETRYABLE_CODES = new Set([
    "outofhostcapacity",
    "serviceunavailable",
    "internalerror",
    "toomanyrequests",
    "requesttimeout",
    "gatewaytimeout",
    "badgateway",
    "etimedout",
    "esockettimedout",
    "econnreset",
    "econnrefused",
    "econnaborted",
    "timeouterror",
]);

export const NON_RETRYABLE_CODES = new Set([
    "notauthenticated",
    "notauthorized",
    "notauthorizedornotfound",
    "quotaexceeded",
    "limitexceeded",
    "invalidparameter",
    "badinput",
    "conflict",
    "alreadyexists",
]);

export function extractErrorCode(error) {
    return (
        error?.code ??
        error?.serviceCode ??
        error?.body?.code ??
        error?.response?.data?.code ??
        error?.status ??
        error?.statusCode ??
        "UNKNOWN_ERROR"
    );
}

export function extractErrorMessage(error) {
    const rawMessage =
        error?.message ??
        error?.body?.message ??
        error?.response?.data?.message ??
        "Unknown provisioning error";

    // Sanitize any credentials or sensitive tokens from error message
    return String(rawMessage)
        .replace(/-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----/gi, "[REDACTED_KEY]")
        .replace(/(token|key|secret|password|authorization)=["']?[^"'\s&]+["']?/gi, "$1=[REDACTED]");
}

/**
 * Classifies an error into retryable or permanent categories.
 */
export function classifyError(error) {
    const rawCode = extractErrorCode(error);
    const code = String(rawCode).toLowerCase().replace(/[^a-z0-9]/g, "");
    const message = extractErrorMessage(error).toLowerCase();
    const statusCode = Number(error?.statusCode || error?.status || 0);

    // 1. Explicitly retryable errors
    if (
        code.includes("outofhostcapacity") ||
        message.includes("out of host capacity") ||
        message.includes("outofhostcapacity")
    ) {
        return {
            retryable: true,
            category: "OUT_OF_HOST_CAPACITY",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    if (
        statusCode === 503 ||
        code.includes("serviceunavailable") ||
        message.includes("service unavailable")
    ) {
        return {
            retryable: true,
            category: "SERVICE_UNAVAILABLE",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    if (
        statusCode === 429 ||
        code.includes("toomanyrequests") ||
        message.includes("too many requests") ||
        message.includes("rate limit")
    ) {
        return {
            retryable: true,
            category: "RATE_LIMITED",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    if (
        statusCode === 502 ||
        statusCode === 504 ||
        statusCode === 500 ||
        code.includes("timeout") ||
        code.includes("timedout") ||
        code.includes("connreset") ||
        code.includes("connaborted") ||
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("network error") ||
        message.includes("fetch failed")
    ) {
        return {
            retryable: true,
            category: "TRANSIENT_NETWORK_ERROR",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    // 2. Explicitly non-retryable errors
    if (
        statusCode === 401 ||
        code.includes("notauthenticated") ||
        code.includes("invalidcredentials") ||
        message.includes("not authenticated") ||
        message.includes("invalid private key")
    ) {
        return {
            retryable: false,
            category: "AUTHENTICATION_FAILED",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    if (
        statusCode === 403 ||
        code.includes("notauthorized") ||
        message.includes("not authorized") ||
        message.includes("permission denied")
    ) {
        return {
            retryable: false,
            category: "PERMISSION_DENIED",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    if (
        code.includes("quotaexceeded") ||
        code.includes("limitexceeded") ||
        message.includes("quota exceeded") ||
        message.includes("limit exceeded")
    ) {
        return {
            retryable: false,
            category: "QUOTA_EXCEEDED",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    if (
        statusCode === 400 ||
        code.includes("invalidparameter") ||
        code.includes("badinput") ||
        message.includes("invalid parameter")
    ) {
        return {
            retryable: false,
            category: "INVALID_CONFIGURATION",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    if (
        statusCode === 409 ||
        code.includes("conflict") ||
        code.includes("alreadyexists")
    ) {
        return {
            retryable: false,
            category: "INSTANCE_ALREADY_EXISTS",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    // Default: Check known sets
    if (RETRYABLE_CODES.has(code)) {
        return {
            retryable: true,
            category: "TRANSIENT_ERROR",
            code: String(rawCode),
            message: extractErrorMessage(error),
        };
    }

    return {
        retryable: false,
        category: "NON_RETRYABLE_ERROR",
        code: String(rawCode),
        message: extractErrorMessage(error),
    };
}

export function isRetryableProvisioningError(error) {
    return classifyError(error).retryable;
}

export function getRetryDelayMinutes(attemptCount, { enableJitter = false, jitterMs = null } = {}) {
    const index = Math.max(0, attemptCount - 1);
    const baseMinutes = RETRY_DELAYS_MINUTES[
        Math.min(index, RETRY_DELAYS_MINUTES.length - 1)
    ];

    if (!enableJitter) {
        return baseMinutes;
    }

    // Optional jitter to avoid synchronized bursts from concurrent workers
    const jitter = jitterMs !== null ? jitterMs : Math.floor(Math.random() * 30000); // 0-30s
    return baseMinutes + (jitter / 60000);
}

async function failProvisioningJob(
    job,
    errorCode,
    errorMessage,
    workerId
) {
    const updatedJob = await markProvisioningFailed(
        job.id,
        {
            errorCode,
            errorMessage,
        },
        workerId
    );

    if (!updatedJob) {
        throw new Error(
            `Unable to mark provisioning job ${job.id} as FAILED. Lock may have expired.`
        );
    }

    return updatedJob;
}

export async function handleProvisioningFailure(
    job,
    error,
    { workerId = null, enableJitter = true } = {}
) {
    const classification = classifyError(error);
    const errorCode = classification.code;
    const errorMessage = classification.message;

    // Error yang tidak dapat di-retry.
    if (!classification.retryable) {
        await failProvisioningJob(
            job,
            errorCode,
            errorMessage,
            workerId
        );

        return {
            status: "FAILED",
            retryScheduled: false,
            reason: classification.category,
            errorCode,
            errorMessage,
        };
    }

    // Batas maksimal percobaan.
    if (job.attempt_count >= job.max_attempts) {
        await failProvisioningJob(
            job,
            errorCode,
            `Maximum attempts reached. Last error: ${errorMessage}`,
            workerId
        );

        return {
            status: "FAILED",
            retryScheduled: false,
            reason: "MAX_ATTEMPTS_REACHED",
            errorCode,
            errorMessage,
        };
    }

    // Jadwalkan percobaan berikutnya dengan exponential backoff dan jitter
    const delayMinutes = getRetryDelayMinutes(job.attempt_count, { enableJitter });
    const nextRetryAt = new Date(Date.now() + Math.round(delayMinutes * 60 * 1000));

    const updatedJob = await scheduleProvisioningRetry(
        job.id,
        {
            nextRetryAt,
            errorCode,
            errorMessage,
        },
        workerId
    );

    if (!updatedJob) {
        throw new Error(
            `Unable to schedule retry for provisioning job ${job.id}. Lock may have expired.`
        );
    }

    return {
        status: "RETRYING",
        retryScheduled: true,
        delayMinutes: Math.round(delayMinutes),
        nextRetryAt: updatedJob.next_retry_at,
        attemptCount: updatedJob.attempt_count,
        maxAttempts: updatedJob.max_attempts,
        reason: classification.category,
        errorCode,
        errorMessage,
    };
}
