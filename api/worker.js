import { randomUUID } from "node:crypto";
import {
    claimDueProvisioningJobs,
    markProvisioningSucceeded,
    failExhaustedProvisioningJobs,
} from "../src/services/database/provisioning.repository.js";
import {
    launchVps,
    findInstanceByProvisioningJobId,
} from "../src/services/oci/instance.service.js";
import { handleProvisioningFailure } from "../src/services/oci/retry.service.js";
import {
    notifyProvisioningSuccess,
    notifyProvisioningFailure,
    recoverUnnotifiedJobs,
} from "../src/services/telegram/notification.service.js";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed",
        });
    }

    const workerSecret = process.env.WORKER_SECRET;
    const authorization = req.headers.authorization;

    if (!workerSecret || authorization !== `Bearer ${workerSecret}`) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

    const workerId = `worker-${randomUUID()}`;

    try {
        const exhaustedJobs = await failExhaustedProvisioningJobs();

        if (exhaustedJobs.length > 0) {
            console.log("[WORKER] Failed exhausted jobs:", {
                jobIds: exhaustedJobs.map((job) => job.id),
            });

            // Notify users about exhausted attempts
            for (const exhaustedJob of exhaustedJobs) {
                notifyProvisioningFailure(exhaustedJob, {
                    reason: "MAX_ATTEMPTS_REACHED",
                    errorMessage: "Batas maksimal percobaan telah tercapai tanpa hasil berhasil.",
                }).catch((err) =>
                    console.error("[WORKER] Failed to notify exhausted job:", err.message)
                );
            }
        }

        // Recover any unnotified succeeded jobs
        recoverUnnotifiedJobs().catch((err) =>
            console.error("[WORKER] Failed to run notification recovery:", err.message)
        );

        const jobs = await claimDueProvisioningJobs(workerId, 1);

        if (!jobs.length) {
            return res.status(200).json({
                success: true,
                message: "No due provisioning jobs",
                processed: 0,
            });
        }

        const job = jobs[0];

        console.log("[WORKER] Processing job:", {
            jobId: job.id,
            attempt: job.attempt_count,
            maxAttempts: job.max_attempts,
            workerId,
        });

        // STEP 1: Reconcile with OCI before attempting another launch.
        let existingInstance;

        try {
            existingInstance = await findInstanceByProvisioningJobId(
                job.id,
                job.config,
            );
        } catch (error) {
            console.error("[WORKER] OCI reconciliation failed:", {
                jobId: job.id,
                errorCode: error.code ?? error.serviceCode ?? "UNKNOWN",
                errorMessage: error.message,
            });

            // Do not launch if OCI state cannot be checked.
            // The DB lock will expire and a later worker can retry.
            throw error;
        }

        let instance;
        let reconciled = false;

        if (existingInstance) {
            instance = existingInstance;
            reconciled = true;

            console.log("[WORKER] Existing instance reconciled:", {
                jobId: job.id,
                instanceId: instance.id,
                lifecycleState: instance.lifecycleState,
            });
        } else {
            // STEP 2: No matching instance; submit launch request.
            console.log("[WORKER] No matching instance. Launching:", {
                jobId: job.id,
            });

            try {
                instance = await launchVps(
                    job.retry_token,
                    job.config,
                    job.id,
                );
            } catch (error) {
                console.error("[WORKER] OCI launch failed:", {
                    jobId: job.id,
                    errorCode: error.code ?? error.serviceCode ?? "UNKNOWN",
                    errorMessage: error.message,
                });

                const result = await handleProvisioningFailure(
                    job,
                    error,
                    { workerId },
                );

                if (result.status === "FAILED") {
                    notifyProvisioningFailure(job, result).catch((err) =>
                        console.error("[WORKER] Failed to notify failure:", err.message)
                    );
                }

                return res.status(200).json({
                    success: true,
                    processed: 1,
                    jobId: job.id,
                    status: result.status,
                    retryScheduled: result.retryScheduled,
                    nextRetryAt: result.nextRetryAt ?? null,
                    reason: result.reason ?? null,
                });
            }
        }

        // STEP 3: Persist the instance result.
        const updatedJob = await markProvisioningSucceeded(
            job.id,
            {
                instanceId: instance.id,
                instanceState: instance.lifecycleState,
                publicIp: instance.publicIp || null,
            },
            workerId,
        );

        if (!updatedJob) {
            throw new Error(
                `Job ${job.id} no longer belongs to worker ${workerId}`,
            );
        }

        console.log("[WORKER] Provisioning succeeded:", {
            jobId: job.id,
            instanceId: instance.id,
            lifecycleState: instance.lifecycleState,
            reconciled,
        });

        // Send idempotent Telegram success notification to the user
        notifyProvisioningSuccess(job, instance).catch((err) =>
            console.error("[WORKER] Failed to send success notification:", err.message)
        );

        return res.status(200).json({
            success: true,
            processed: 1,
            jobId: job.id,
            status: "SUCCEEDED",
            reconciled,
            instance,
        });
    } catch (error) {
        console.error("[WORKER ERROR]", {
            message: error.message,
            code: error.code ?? error.serviceCode ?? "UNKNOWN",
        });

        return res.status(500).json({
            success: false,
            message: "Worker execution failed",
            error: error.message,
        });
    }
}
