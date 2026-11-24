import { randomUUID } from "node:crypto";

import {
    claimDueProvisioningJobs,
    markProvisioningSucceeded,
    failExhaustedProvisioningJobs,
    renewProvisioningJobLock,
} from "../src/services/database/provisioning.repository.js";

import {
    launchVps,
    findInstanceByProvisioningJobId,
} from "../src/services/oci/instance.service.js";

import {
    handleProvisioningFailure,
} from "../src/services/oci/retry.service.js";

import {
    notifyProvisioningSuccess,
    notifyProvisioningFailure,
    recoverUnnotifiedJobs,
} from "../src/services/telegram/notification.service.js";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Memperpanjang provisioning lock selama operasi OCI berjalan.
 *
 * Heartbeat berjalan setiap 2 menit.
 * Tidak menjalankan heartbeat secara bersamaan.
 *
 * Jika lock hilang atau database gagal memperpanjang lock,
 * operasi dianggap tidak aman untuk dilanjutkan sebagai job aktif.
 */
async function withProvisioningHeartbeat(
    job,
    workerId,
    callback
) {
    let heartbeatError = null;
    let heartbeatPromise = null;

    const heartbeat = async () => {
        if (heartbeatPromise || heartbeatError) {
            return;
        }

        heartbeatPromise = (async () => {
            try {
                const renewed = await renewProvisioningJobLock(
                    job.id,
                    workerId
                );

                if (!renewed) {
                    const error = new Error(
                        `Worker lock lost for provisioning job ${job.id}`
                    );

                    error.code = "WORKER_LOCK_LOST";
                    heartbeatError = error;
                }
            } catch (error) {
                const heartbeatFailure = new Error(
                    `Failed to renew provisioning lock for job ${job.id}: ${error.message}`,
                    { cause: error }
                );

                heartbeatFailure.code = "WORKER_HEARTBEAT_FAILED";
                heartbeatError = heartbeatFailure;
            }
        })();

        await heartbeatPromise;
        heartbeatPromise = null;
    };

    const timer = setInterval(() => {
        void heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    let result;
    let operationError = null;

    try {
        result = await callback();
    } catch (error) {
        operationError = error;
    } finally {
        clearInterval(timer);

        // Tunggu heartbeat yang mungkin masih berjalan.
        if (heartbeatPromise) {
            await heartbeatPromise;
            heartbeatPromise = null;
        }
    }

    // Jangan melanjutkan proses jika worker kehilangan lock.
    if (heartbeatError) {
        throw heartbeatError;
    }

    if (operationError) {
        throw operationError;
    }

    return result;
}

/**
 * Memeriksa apakah error berasal dari heartbeat.
 *
 * Error ini tidak boleh langsung diproses sebagai kegagalan OCI
 * karena kepemilikan worker lock sudah tidak dapat dipastikan.
 */
function isHeartbeatError(error) {
    return [
        "WORKER_LOCK_LOST",
        "WORKER_HEARTBEAT_FAILED",
    ].includes(error?.code);
}

/**
 * Menjalankan notifikasi tanpa membuat kegagalan notifikasi
 * menghentikan keseluruhan worker.
 */
async function safelyNotify(label, callback) {
    try {
        return await callback();
    } catch (error) {
        console.error(`[WORKER] ${label} failed:`, {
            message: error.message,
        });

        return false;
    }
}

/**
 * Menangani error OCI dan menentukan retry atau permanent failure.
 */
async function processProvisioningFailure(job, error, workerId) {
    const result = await handleProvisioningFailure(
        job,
        error,
        { workerId }
    );

    if (result?.status === "FAILED") {
        await safelyNotify(
            "Failure notification",
            () => notifyProvisioningFailure(job, result)
        );
    }

    return result;
}

/**
 * Worker utama provisioning.
 */
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed",
        });
    }

    const workerSecret = process.env.WORKER_SECRET;
    const authorization = req.headers.authorization;

    if (
        !workerSecret ||
        authorization !== `Bearer ${workerSecret}`
    ) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

    const workerId = `worker-${randomUUID()}`;

    try {
        /*
         * STEP 1:
         * Tandai job yang sudah menghabiskan seluruh percobaan
         * dan lock-nya sudah kedaluwarsa sebagai FAILED.
         */
        const exhaustedJobs = await failExhaustedProvisioningJobs();

        if (exhaustedJobs.length > 0) {
            console.log("[WORKER] Exhausted jobs:", {
                jobIds: exhaustedJobs.map((job) => job.id),
            });

            for (const job of exhaustedJobs) {
                await safelyNotify(
                    "Exhausted job notification",
                    () => notifyProvisioningFailure(job, {
                        reason: "MAX_ATTEMPTS_REACHED",
                        errorMessage: job.error_message,
                        attemptCount: job.attempt_count,
                    })
                );
            }
        }

        /*
         * STEP 2:
         * Recovery notifikasi SUCCEEDED dan FAILED
         * yang belum berhasil dikirim.
         */
        await recoverUnnotifiedJobs(10);

        /*
         * STEP 3:
         * Ambil satu provisioning job yang sudah jatuh tempo.
         */
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

        /*
         * STEP 4:
         * Reconciliation OCI.
         *
         * Heartbeat aktif selama proses pencarian instance.
         * Jangan melakukan launch jika OCI gagal diperiksa.
         */
        let existingInstance;

        try {
            existingInstance = await withProvisioningHeartbeat(
                job,
                workerId,
                () => findInstanceByProvisioningJobId(
                    job.id,
                    job.config
                )
            );
        } catch (error) {
            if (isHeartbeatError(error)) {
                throw error;
            }

            console.error("[WORKER] OCI reconciliation failed:", {
                jobId: job.id,
                errorCode: error.code ?? error.serviceCode ?? "UNKNOWN",
                errorMessage: error.message,
            });

            const result = await processProvisioningFailure(
                job,
                error,
                workerId
            );

            return res.status(200).json({
                success: true,
                processed: 1,
                jobId: job.id,
                status: result?.status ?? "UNKNOWN",
                retryScheduled: result?.retryScheduled ?? false,
                nextRetryAt: result?.nextRetryAt ?? null,
                reason: result?.reason ?? null,
                stage: "RECONCILIATION",
            });
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
            /*
             * STEP 5:
             * Tidak ada instance yang cocok.
             * Jalankan provisioning OCI.
             *
             * Heartbeat aktif selama launch berlangsung.
             */
            console.log("[WORKER] Launching OCI instance:", {
                jobId: job.id,
            });

            try {
                instance = await withProvisioningHeartbeat(
                    job,
                    workerId,
                    () => launchVps(
                        job.retry_token,
                        job.config,
                        job.id
                    )
                );
            } catch (error) {
                if (isHeartbeatError(error)) {
                    throw error;
                }

                console.error("[WORKER] OCI launch failed:", {
                    jobId: job.id,
                    errorCode: error.code ?? error.serviceCode ?? "UNKNOWN",
                    errorMessage: error.message,
                });

                const result = await processProvisioningFailure(
                    job,
                    error,
                    workerId
                );

                return res.status(200).json({
                    success: true,
                    processed: 1,
                    jobId: job.id,
                    status: result?.status ?? "UNKNOWN",
                    retryScheduled: result?.retryScheduled ?? false,
                    nextRetryAt: result?.nextRetryAt ?? null,
                    reason: result?.reason ?? null,
                    stage: "LAUNCH",
                });
            }
        }

        /*
         * STEP 6:
         * Simpan hasil provisioning.
         *
         * Jika lock hilang, repository akan menolak update.
         */
        const updatedJob = await markProvisioningSucceeded(
            job.id,
            {
                instanceId: instance.id,
                instanceState: instance.lifecycleState,
                publicIp: instance.publicIp || null,
            },
            workerId
        );

        if (!updatedJob) {
            throw new Error(
                `Job ${job.id} no longer belongs to worker ${workerId}`
            );
        }

        console.log("[WORKER] Provisioning succeeded:", {
            jobId: job.id,
            instanceId: instance.id,
            lifecycleState: instance.lifecycleState,
            reconciled,
        });

        /*
         * STEP 7:
         * Kirim notifikasi keberhasilan.
         *
         * Jika gagal, recovery cron berikutnya akan mencoba kembali.
         */
        await safelyNotify(
            "Success notification",
            () => notifyProvisioningSuccess(updatedJob, instance)
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