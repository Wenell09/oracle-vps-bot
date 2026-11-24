import { bot } from "../../bot.js";
import { markJobNotified, findUnnotifiedSucceededJobs } from "../database/provisioning.repository.js";
import { getInstancePublicIp } from "../oci/instance.service.js";

/**
 * Format timestamp into readable Indonesian/Jakarta time.
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
 * Kirim notifikasi keberhasilan provisioning ke pengguna secara idempoten.
 */
export async function notifyProvisioningSuccess(job, instance = null) {
    if (!job?.id || !job?.telegram_chat_id) {
        return false;
    }

    // Atomic idempotency check: hanya kirim jika belum pernah dinotifikasi
    const marked = await markJobNotified(job.id);
    if (!marked) {
        console.log("[NOTIFICATION] Job already notified, skipping:", job.id);
        return false;
    }

    try {
        let publicIp = job.public_ip || instance?.publicIp;

        // Jika public IP belum ada, coba lookup dari VNIC OCI
        if (!publicIp && instance?.id) {
            try {
                publicIp = await getInstancePublicIp(instance.id, job.config?.compartmentId);
            } catch (err) {
                console.error("[NOTIFICATION] Failed to fetch public IP:", err.message);
            }
        }

        const config = job.config || {};
        const displayName = instance?.displayName || job.display_name || "oracle-vps";
        const shape = instance?.shape || job.shape || "VM.Standard.A1.Flex";
        const ocpus = config.ocpus ?? 1;
        const memoryInGBs = config.memoryInGBs ?? 6;
        const region = process.env.OCI_REGION || "ap-batam-1";
        const status = instance?.lifecycleState || "RUNNING";
        const instanceId = instance?.id || job.instance_id || "-";
        const createdAt = formatTime(job.created_at || Date.now());

        const message = [
            "🎉 *VPS PROVISIONING BERHASIL!*",
            "",
            `📌 *Nama Instance:* \`${displayName}\``,
            `🌐 *Public IP:* \`${publicIp || "Sedang dialokasikan (periksa beberapa saat lagi)"}\``,
            `⚙️ *Shape:* \`${shape}\` (${ocpus} OCPU, ${memoryInGBs} GB RAM)`,
            `🐧 *OS:* \`Ubuntu 24.04 ARM64\``,
            `👤 *SSH User:* \`ubuntu\``,
            `📍 *Region:* \`${region}\``,
            `📊 *Status:* \`${status}\``,
            `🆔 *Instance OCID:* \`${instanceId}\``,
            `🕒 *Dibuat:* ${createdAt}`,
            "",
            "💡 *Cara Koneksi SSH:*",
            `\`ssh ubuntu@${publicIp || "<IP_ADDRESS>"}\``,
            "",
            "Gunakan perintah /list atau /status untuk mengelola instance kamu.",
        ].join("\n");

        await bot.api.sendMessage(job.telegram_chat_id, message, {
            parse_mode: "Markdown",
        });

        console.log("[NOTIFICATION] Success notification sent:", {
            jobId: job.id,
            chatId: job.telegram_chat_id,
        });

        return true;
    } catch (error) {
        console.error("[NOTIFICATION ERROR] Failed to send success notification:", {
            jobId: job.id,
            error: error.message,
        });
        return false;
    }
}

/**
 * Kirim notifikasi kegagalan permanen provisioning ke pengguna secara idempoten.
 */
export async function notifyProvisioningFailure(job, failureDetails = {}) {
    if (!job?.id || !job?.telegram_chat_id) {
        return false;
    }

    const marked = await markJobNotified(job.id);
    if (!marked) {
        console.log("[NOTIFICATION] Job failure already notified, skipping:", job.id);
        return false;
    }

    try {
        const displayName = job.display_name || "oracle-vps";
        const reason = failureDetails.reason || job.error_code || "MAX_ATTEMPTS_REACHED";
        const errorMessage = failureDetails.errorMessage || job.error_message || "Provisioning gagal.";
        const attemptCount = failureDetails.attemptCount || job.attempt_count || job.max_attempts;

        const message = [
            "⚠️ *VPS PROVISIONING GAGAL*",
            "",
            `📌 *Nama Instance:* \`${displayName}\``,
            `🆔 *Job ID:* \`${job.id}\``,
            `🔄 *Total Percobaan:* ${attemptCount}/${job.max_attempts}`,
            `❌ *Alasan:* \`${reason}\``,
            `📝 *Detail Error:* ${errorMessage}`,
            "",
            "Sistem telah menghentikan percobaan otomatis untuk job ini.",
            "Kamu dapat mencoba kembali menggunakan /create jika diperlukan.",
        ].join("\n");

        await bot.api.sendMessage(job.telegram_chat_id, message, {
            parse_mode: "Markdown",
        });

        console.log("[NOTIFICATION] Failure notification sent:", {
            jobId: job.id,
            chatId: job.telegram_chat_id,
        });

        return true;
    } catch (error) {
        console.error("[NOTIFICATION ERROR] Failed to send failure notification:", {
            jobId: job.id,
            error: error.message,
        });
        return false;
    }
}

/**
 * Recovery helper untuk mengirim notifikasi yang sempat tertunda.
 */
export async function recoverUnnotifiedJobs() {
    try {
        const unnotifiedJobs = await findUnnotifiedSucceededJobs(10);
        for (const job of unnotifiedJobs) {
            console.log("[NOTIFICATION RECOVERY] Processing unnotified job:", job.id);
            await notifyProvisioningSuccess(job, {
                id: job.instance_id,
                displayName: job.display_name,
                lifecycleState: job.instance_state,
                shape: job.shape,
                publicIp: job.public_ip,
            });
        }
    } catch (error) {
        console.error("[NOTIFICATION RECOVERY] Error:", error.message);
    }
}
