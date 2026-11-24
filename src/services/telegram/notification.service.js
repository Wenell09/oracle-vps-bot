import { randomUUID } from "node:crypto";
import { bot } from "../../bot.js";

import {
    claimJobNotification,
    markJobNotified,
    releaseJobNotification,
    findUnnotifiedJobs,
} from "../database/provisioning.repository.js";

import { getInstancePublicIp } from "../oci/instance.service.js";

/**
 * Escape karakter HTML untuk Telegram.
 */
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Format waktu ke timezone Jakarta.
 */
function formatTime(date) {
    if (!date) return "-";

    return new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "Asia/Jakarta",
    }).format(new Date(date));
}

/**
 * Pengiriman notifikasi dengan notification lock.
 *
 * Notifikasi hanya dianggap terkirim setelah sendMessage berhasil
 * dan notified_at berhasil diperbarui di database.
 */
async function deliverNotification(job, buildMessage) {
    if (!job?.id || !job?.telegram_chat_id) {
        return false;
    }

    const workerId = `notification-${randomUUID()}`;

    let claimedJob;

    try {
        claimedJob = await claimJobNotification(job.id, workerId);
    } catch (error) {
        console.error("[NOTIFICATION] Failed to claim notification:", {
            jobId: job.id,
            message: error.message,
        });

        return false;
    }

    if (!claimedJob) {
        console.log("[NOTIFICATION] Already notified or locked:", {
            jobId: job.id,
        });

        return false;
    }

    try {
        const message = await buildMessage(claimedJob);

        await bot.api.sendMessage(
            claimedJob.telegram_chat_id,
            message,
            {
                parse_mode: "HTML",
            }
        );

        const updatedJob = await markJobNotified(
            claimedJob.id,
            workerId
        );

        if (!updatedJob) {
            throw new Error(
                "Telegram message sent, but notification status could not be updated."
            );
        }

        console.log("[NOTIFICATION] Notification sent:", {
            jobId: claimedJob.id,
            status: claimedJob.status,
        });

        return true;
    } catch (error) {
        console.error("[NOTIFICATION] Delivery failed:", {
            jobId: claimedJob.id,
            message: error.message,
        });

        try {
            await releaseJobNotification(
                claimedJob.id,
                workerId,
                error.message
            );
        } catch (releaseError) {
            console.error("[NOTIFICATION] Failed to release lock:", {
                jobId: claimedJob.id,
                message: releaseError.message,
            });
        }

        return false;
    }
}

/**
 * Notifikasi provisioning berhasil.
 */
export async function notifyProvisioningSuccess(job, instance = null) {
    return deliverNotification(job, async (claimedJob) => {
        let publicIp =
            claimedJob.public_ip ||
            instance?.publicIp ||
            null;

        if (!publicIp && instance?.id) {
            try {
                publicIp = await getInstancePublicIp(
                    instance.id,
                    claimedJob.config?.compartmentId
                );
            } catch (error) {
                console.error("[NOTIFICATION] Public IP lookup failed:", {
                    jobId: claimedJob.id,
                    message: error.message,
                });
            }
        }

        const config = claimedJob.config || {};

        const displayName = escapeHtml(
            instance?.displayName ||
            claimedJob.display_name ||
            "oracle-vps"
        );

        const shape = escapeHtml(
            instance?.shape ||
            claimedJob.shape ||
            "VM.Standard.A1.Flex"
        );

        const ocpus = escapeHtml(config.ocpus ?? 1);
        const memoryInGBs = escapeHtml(config.memoryInGBs ?? 6);

        const region = escapeHtml(
            process.env.OCI_REGION || "ap-batam-1"
        );

        const status = escapeHtml(
            instance?.lifecycleState ||
            claimedJob.instance_state ||
            "RUNNING"
        );

        const instanceId = escapeHtml(
            instance?.id ||
            claimedJob.instance_id ||
            "-"
        );

        const safeIp = escapeHtml(
            publicIp ||
            "Sedang dialokasikan (periksa beberapa saat lagi)"
        );

        const sshIp = publicIp
            ? escapeHtml(publicIp)
            : "&lt;IP_ADDRESS&gt;";

        const createdAt = escapeHtml(
            formatTime(claimedJob.created_at)
        );

        return [
            "🎉 <b>VPS PROVISIONING BERHASIL!</b>",
            "",
            `📌 <b>Nama Instance:</b> <code>${displayName}</code>`,
            `🌐 <b>Public IP:</b> <code>${safeIp}</code>`,
            `⚙️ <b>Shape:</b> <code>${shape}</code> (${ocpus} OCPU, ${memoryInGBs} GB RAM)`,
            "🐧 <b>OS:</b> <code>Ubuntu 24.04 ARM64</code>",
            "👤 <b>SSH User:</b> <code>ubuntu</code>",
            `📍 <b>Region:</b> <code>${region}</code>`,
            `📊 <b>Status:</b> <code>${status}</code>`,
            `🆔 <b>Instance OCID:</b> <code>${instanceId}</code>`,
            `🕒 <b>Dibuat:</b> ${createdAt}`,
            "",
            "💡 <b>Cara Koneksi SSH:</b>",
            `<code>ssh ubuntu@${sshIp}</code>`,
            "",
            "Gunakan perintah /list atau /status untuk mengelola instance kamu.",
        ].join("\n");
    });
}

/**
 * Notifikasi provisioning gagal permanen.
 */
export async function notifyProvisioningFailure(
    job,
    failureDetails = {}
) {
    return deliverNotification(job, async (claimedJob) => {
        const displayName = escapeHtml(
            claimedJob.display_name || "oracle-vps"
        );

        const reason = escapeHtml(
            failureDetails.reason ||
            claimedJob.error_code ||
            "MAX_ATTEMPTS_REACHED"
        );

        const errorMessage = escapeHtml(
            failureDetails.errorMessage ||
            claimedJob.error_message ||
            "Provisioning gagal."
        );

        const attemptCount = escapeHtml(
            failureDetails.attemptCount ??
            claimedJob.attempt_count ??
            0
        );

        const maxAttempts = escapeHtml(
            claimedJob.max_attempts ?? 0
        );

        return [
            "⚠️ <b>VPS PROVISIONING GAGAL</b>",
            "",
            `📌 <b>Nama Instance:</b> <code>${displayName}</code>`,
            `🆔 <b>Job ID:</b> <code>${claimedJob.id}</code>`,
            `🔄 <b>Total Percobaan:</b> ${attemptCount}/${maxAttempts}`,
            `❌ <b>Alasan:</b> <code>${reason}</code>`,
            `📝 <b>Detail Error:</b> ${errorMessage}`,
            "",
            "Sistem telah menghentikan percobaan otomatis untuk job ini.",
            "Kamu dapat mencoba kembali menggunakan /create jika diperlukan.",
        ].join("\n");
    });
}

/**
 * Recovery notifikasi job SUCCEEDED dan FAILED.
 */
export async function recoverUnnotifiedJobs(limit = 10) {
    try {
        const jobs = await findUnnotifiedJobs(limit);

        let sent = 0;
        let failed = 0;

        for (const job of jobs) {
            let result = false;

            if (job.status === "SUCCEEDED") {
                result = await notifyProvisioningSuccess(job, {
                    id: job.instance_id,
                    displayName: job.display_name,
                    lifecycleState: job.instance_state,
                    shape: job.shape,
                    publicIp: job.public_ip,
                });
            } else if (job.status === "FAILED") {
                result = await notifyProvisioningFailure(job);
            }

            if (result) {
                sent++;
            } else {
                failed++;
            }
        }

        const summary = {
            processed: jobs.length,
            sent,
            failed,
        };

        console.log("[NOTIFICATION RECOVERY] Completed:", summary);

        return summary;
    } catch (error) {
        console.error("[NOTIFICATION RECOVERY] Failed:", {
            message: error.message,
        });

        return {
            processed: 0,
            sent: 0,
            failed: 0,
        };
    }
}