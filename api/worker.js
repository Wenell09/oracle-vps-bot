
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

export default async function handler(req, res) {
    // Worker hanya menerima POST.
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed",
        });
    }

    // Autentikasi worker.
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
        console.log("[WORKER] Starting:", workerId);

        // 1. Fail job yang sudah habis attempt dan lock expired.
        const exhaustedJobs = await failExhaustedProvisioningJobs();

        if (exhaustedJobs.length > 0) {
            console.log(
                "[WORKER] Failed exhausted jobs:",
                exhaustedJobs.map((job) => job.id)
            );
        }

        // 2. Claim satu job retry yang sudah jatuh tempo.
        const jobs = await claimDueProvisioningJobs(workerId, 1);

        if (!jobs.length) {
            return res.status(200).json({
                success: true,
                message: "No due provisioning jobs",
                processed: 0,
            });
        }

        const job = jobs[0];

        console.log("[WORKER] Claimed job:", {
            jobId: job.id,
            attempt: job.attempt_count,
            maxAttempts: job.max_attempts,
            workerId,
        });

        // 3. RECONCILIATION
        // Periksa apakah instance sudah berhasil dibuat pada
        // percobaan sebelumnya tetapi respons/update database gagal.
        //
        // Jika OCI listInstances gagal, error akan masuk outer catch.
        // Worker TIDAK akan lanjut launch tanpa pemeriksaan yang berhasil.
        const existingInstance = await findInstanceByProvisioningJobId(
            job.id,
            job.config
        );

        if (existingInstance) {
            console.log("[WORKER] Existing instance found:", {
                jobId: job.id,
                instanceId: existingInstance.id,
                lifecycleState: existingInstance.lifecycleState,
            });

            // 4. Instance sudah ditemukan, tandai job berhasil.
            const updatedJob = await markProvisioningSucceeded(
                job.id,
                {
                    instanceId: existingInstance.id,
                    instanceState: existingInstance.lifecycleState,
                },
                workerId
            );

            if (!updatedJob) {
                throw new Error(
                    `Unable to reconcile job ${job.id}. ` +
                    `Instance ${existingInstance.id} exists, ` +
                    `but database update failed or worker lock expired.`
                );
            }

            return res.status(200).json({
                success: true,
                processed: 1,
                jobId: job.id,
                status: "SUCCEEDED",
                reconciled: true,
                instance: existingInstance,
            });
        }

        console.log(
            "[WORKER] No existing instance found. Launching VPS:",
            job.id
        );

        // 5. Launch OCI.
        // Job ID dipasang sebagai freeformTag.
        // Retry token tetap menggunakan token yang sama.
        let instance;

        try {
            instance = await launchVps(
                job.retry_token,
                job.config,
                job.id
            );
        } catch (error) {
            console.error("[WORKER] OCI launch failed:", {
                jobId: job.id,
                attempt: job.attempt_count,
                errorCode:
                    error?.code ??
                    error?.serviceCode ??
                    "UNKNOWN_ERROR",
                message: error?.message,
            });

            // 6. Proses retry atau terminal failure.
            const result = await handleProvisioningFailure(
                job,
                error,
                { workerId }
            );

            console.log("[WORKER] Failure handled:", {
                jobId: job.id,
                status: result.status,
                retryScheduled: result.retryScheduled,
                nextRetryAt: result.nextRetryAt ?? null,
                reason: result.reason ?? null,
            });

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

        // 7. Launch berhasil. Update database.
        // Tidak masuk catch launch agar DB failure tidak dianggap
        // sebagai kegagalan request OCI.
        const updatedJob = await markProvisioningSucceeded(
            job.id,
            {
                instanceId: instance.id,
                instanceState: instance.lifecycleState,
            },
            workerId
        );

        if (!updatedJob) {
            throw new Error(
                `OCI instance ${instance.id} was created, ` +
                `but provisioning job ${job.id} could not be updated. ` +
                `Worker lock may have expired.`
            );
        }

        console.log("[WORKER] Provisioning succeeded:", {
            jobId: job.id,
            instanceId: instance.id,
            lifecycleState: instance.lifecycleState,
        });

        return res.status(200).json({
            success: true,
            processed: 1,
            jobId: job.id,
            status: "SUCCEEDED",
            reconciled: false,
            instance,
        });
    } catch (error) {
        console.error("[WORKER ERROR]", {
            workerId,
            message: error?.message,
            stack: error?.stack,
        });

        return res.status(500).json({
            success: false,
            message: "Worker execution failed",
            error: error?.message ?? "Unknown worker error",
            workerId,
        });
    }
}
