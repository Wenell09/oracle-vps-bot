import {
    scheduleProvisioningRetry,
    markProvisioningFailed,
} from "../database/provisioning.repository.js";

const RETRY_DELAYS_MINUTES = [1, 3, 5, 10, 15];

function extractErrorCode(error) {
    return (
        error?.code ??
        error?.serviceCode ??
        error?.body?.code ??
        error?.response?.data?.code ??
        "UNKNOWN_ERROR"
    );
}

function extractErrorMessage(error) {
    return error?.message ?? "Unknown provisioning error";
}

export function isRetryableProvisioningError(error) {
    const code = String(extractErrorCode(error)).toLowerCase();
    const message = extractErrorMessage(error).toLowerCase();

    return (
        code === "outofhostcapacity" ||
        message.includes("out of host capacity") ||
        message.includes("outofhostcapacity")
    );
}

function getRetryDelayMinutes(attemptCount) {
    const index = Math.max(0, attemptCount - 1);

    return RETRY_DELAYS_MINUTES[
        Math.min(index, RETRY_DELAYS_MINUTES.length - 1)
    ];
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
    { workerId = null } = {}
) {
    const errorCode = String(extractErrorCode(error));
    const errorMessage = extractErrorMessage(error);

    // Error yang tidak dapat di-retry.
    if (!isRetryableProvisioningError(error)) {
        await failProvisioningJob(
            job,
            errorCode,
            errorMessage,
            workerId
        );

        return {
            status: "FAILED",
            retryScheduled: false,
            reason: "NON_RETRYABLE_ERROR",
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
        };
    }

    // Jadwalkan percobaan berikutnya.
    const delayMinutes = getRetryDelayMinutes(job.attempt_count);

    const nextRetryAt = new Date(
        Date.now() + delayMinutes * 60 * 1000
    );

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
        delayMinutes,
        nextRetryAt: updatedJob.next_retry_at,
        attemptCount: updatedJob.attempt_count,
        maxAttempts: updatedJob.max_attempts,
    };
}