import { InlineKeyboard } from "grammy";
import {
    findLatestProvisioningJob,
    listProvisioningJobsByUser,
    findProvisioningJobByInstanceId,
    updateInstanceState,
} from "../services/database/provisioning.repository.js";
import {
    listActiveProvisioningJobs,
} from "../services/database/retry-management.repository.js";
import {
    getInstanceDetails,
    getInstancePublicIp,
    performInstanceAction,
    terminateVpsInstance,
    isInstanceActive,
} from "../services/oci/instance.service.js";
import { launchVpsCommand } from "./launch-vps.js";

function isUserAuthorized(ctx) {
    const adminId = process.env.ALLOWED_TELEGRAM_USER_ID || process.env.TELEGRAM_ADMIN_ID;
    if (!adminId) return true; // Jika tidak diset, izinkan user berinteraksi
    return String(ctx.from?.id ?? "").trim() === String(adminId).trim();
}

async function verifyInstanceOwnership(instanceId, telegramUserId) {
    const adminId = process.env.ALLOWED_TELEGRAM_USER_ID || process.env.TELEGRAM_ADMIN_ID;
    if (adminId && String(telegramUserId) === String(adminId).trim()) {
        return true;
    }

    const job = await findProvisioningJobByInstanceId(instanceId);
    if (!job) {
        return false;
    }

    return String(job.telegram_user_id) === String(telegramUserId);
}

function formatDate(date) {
    if (!date) return "-";
    return new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "Asia/Jakarta",
    }).format(new Date(date));
}

/**
 * /create command: Memulai alur pembuatan VPS
 */
export async function createCommand(ctx) {
    return launchVpsCommand(ctx);
}

/**
 * /status command: Cek status VPS terbaru milik pengguna
 */
export async function statusCommand(ctx) {
    const telegramUserId = ctx.from?.id;

    try {
        await ctx.reply("Sedang memeriksa status VPS kamu...");

        const latestJob = await findLatestProvisioningJob(telegramUserId);

        if (!latestJob) {
            return ctx.reply(
                "Kamu belum memiliki VPS atau riwayat provisioning.\n" +
                "Ketik /create atau /launch_vps untuk membuat VPS baru."
            );
        }

        // Jika job masih dalam proses provisioning
        if (["PENDING", "PROCESSING", "RETRYING"].includes(latestJob.status)) {
            const nextRetry = latestJob.next_retry_at ? formatDate(latestJob.next_retry_at) : "Segera";
            return ctx.reply(
                [
                    "⏳ *PROVISIONING SEDANG BERJALAN*",
                    "",
                    `📌 *Nama:* \`${latestJob.display_name}\``,
                    `📊 *Status:* \`${latestJob.status}\``,
                    `🔄 *Percobaan:* ${latestJob.attempt_count}/${latestJob.max_attempts}`,
                    `🕒 *Jadwal Berikutnya:* ${nextRetry}`,
                    latestJob.error_message ? `⚠️ *Catatan:* ${latestJob.error_message}` : "",
                    "",
                    "Bot akan mengirim notifikasi otomatis saat VPS selesai dibuat.",
                ].filter(Boolean).join("\n"),
                { parse_mode: "Markdown" }
            );
        }

        // Jika job gagal
        if (latestJob.status === "FAILED" || latestJob.status === "CANCELLED") {
            return ctx.reply(
                [
                    "❌ *PROVISIONING TERAKHIR GAGAL / DIBATALKAN*",
                    "",
                    `📌 *Nama:* \`${latestJob.display_name}\``,
                    `📊 *Status:* \`${latestJob.status}\``,
                    `❌ *Alasan:* \`${latestJob.error_code || "-"}\``,
                    `📝 *Pesan:* ${latestJob.error_message || "-"}`,
                    `🕒 *Waktu:* ${formatDate(latestJob.completed_at || latestJob.updated_at)}`,
                    "",
                    "Gunakan /create jika ingin mencoba kembali.",
                ].join("\n"),
                { parse_mode: "Markdown" }
            );
        }

        // Job SUCCEEDED: Periksa status real-time OCI
        let ociState = latestJob.instance_state || "UNKNOWN";
        let publicIp = latestJob.public_ip;

        if (latestJob.instance_id) {
            try {
                const details = await getInstanceDetails(latestJob.instance_id);
                ociState = details.lifecycleState;

                if (!publicIp) {
                    publicIp = await getInstancePublicIp(latestJob.instance_id, latestJob.config?.compartmentId);
                }

                // Sinkronkan state terbaru ke database
                await updateInstanceState(latestJob.instance_id, {
                    instanceState: ociState,
                    publicIp,
                });
            } catch (ociError) {
                console.warn("[STATUS] Failed to query real-time OCI state, using cached state:", ociError.message);
            }
        }

        const keyboard = new InlineKeyboard();

        if (latestJob.instance_id && isInstanceActive(ociState)) {
            if (ociState === "RUNNING") {
                keyboard.text("⏹️ Stop VPS", `vps_action:STOP:${latestJob.instance_id}`);
                keyboard.text("🔄 Restart VPS", `vps_action:SOFTRESET:${latestJob.instance_id}`);
            } else if (ociState === "STOPPED") {
                keyboard.text("▶️ Start VPS", `vps_action:START:${latestJob.instance_id}`);
            }
            keyboard.row();
            keyboard.text("🗑️ Terminate VPS", `vps_term_prompt:${latestJob.instance_id}`);
        }

        const msgLines = [
            "🖥️ *STATUS VPS KAMU*",
            "",
            `📌 *Nama:* \`${latestJob.display_name}\``,
            `📊 *State OCI:* \`${ociState}\``,
            `🌐 *Public IP:* \`${publicIp || "Belum tersedia"}\``,
            `⚙️ *Shape:* \`${latestJob.shape}\``,
            `🆔 *Instance OCID:* \`${latestJob.instance_id || "-"}\``,
            `🕒 *Dibuat:* ${formatDate(latestJob.created_at)}`,
        ];

        if (publicIp && ociState === "RUNNING") {
            msgLines.push("", "💡 *SSH:* `ssh ubuntu@" + publicIp + "`");
        }

        return ctx.reply(msgLines.join("\n"), {
            parse_mode: "Markdown",
            reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
        });
    } catch (error) {
        console.error("[STATUS ERROR]", error);
        return ctx.reply(`Gagal mengambil status VPS: ${error.message}`);
    }
}

/**
 * /list command: Menampilkan semua VPS milik pengguna
 */
export async function listCommand(ctx) {
    const telegramUserId = ctx.from?.id;

    try {
        await ctx.reply("Sedang mengambil daftar VPS kamu...");

        const jobs = await listProvisioningJobsByUser(telegramUserId, 15);

        if (!jobs.length) {
            return ctx.reply(
                "Kamu belum memiliki VPS.\n" +
                "Gunakan perintah /create atau /launch_vps untuk membuat instance baru."
            );
        }

        const keyboard = new InlineKeyboard();

        const formattedList = jobs.map((job, idx) => {
            const statusLabel = job.status === "SUCCEEDED" ? (job.instance_state || "RUNNING") : job.status;
            const ip = job.public_ip ? ` | IP: ${job.public_ip}` : "";

            if (job.instance_id && isInstanceActive(job.instance_state)) {
                keyboard.text(`⚙️ Kelola #${idx + 1} (${job.display_name})`, `vps_manage:${job.instance_id}`).row();
            }

            return [
                `*${idx + 1}. ${job.display_name}*`,
                `   • Status: \`${statusLabel}\``,
                `   • Shape: \`${job.shape}\`${ip}`,
                `   • Dibuat: ${formatDate(job.created_at)}`,
            ].join("\n");
        }).join("\n\n");

        return ctx.reply(
            `📋 *DAFTAR VPS KAMU (${jobs.length})*\n\n${formattedList}`,
            {
                parse_mode: "Markdown",
                reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
            }
        );
    } catch (error) {
        console.error("[LIST ERROR]", error);
        return ctx.reply(`Gagal mengambil daftar VPS: ${error.message}`);
    }
}

/**
 * /delete command: Panduan / menu hapus instance VPS
 */
export async function deleteCommand(ctx) {
    const telegramUserId = ctx.from?.id;

    try {
        const jobs = await listProvisioningJobsByUser(telegramUserId, 10);
        const activeInstances = jobs.filter((job) => job.instance_id && isInstanceActive(job.instance_state));

        if (!activeInstances.length) {
            return ctx.reply(
                "Tidak ada instance aktif yang dapat dihapus.\n" +
                "Instance yang sudah berstatus TERMINATED tidak dapat dihapus lagi."
            );
        }

        const keyboard = new InlineKeyboard();
        for (const inst of activeInstances) {
            keyboard.text(`🗑️ Hapus ${inst.display_name}`, `vps_term_prompt:${inst.instance_id}`).row();
        }

        return ctx.reply(
            "⚠️ *PILIH VPS YANG INGIN DIHAPUS:*\n\n" +
            "Penghapusan bersifat PERMANEN dan tidak dapat dibatalkan.",
            {
                parse_mode: "Markdown",
                reply_markup: keyboard,
            }
        );
    } catch (error) {
        console.error("[DELETE COMMAND ERROR]", error);
        return ctx.reply(`Terjadi kesalahan: ${error.message}`);
    }
}

/**
 * Registrasi callback query handlers untuk manajemen instance
 */
export function registerInstanceManagementCallbacks(bot) {
    // Kelola instance dari tombol daftar
    bot.callbackQuery(/^vps_manage:(.+)$/, async (ctx) => {
        const instanceId = ctx.match[1];
        const isOwner = await verifyInstanceOwnership(instanceId, ctx.from.id);

        if (!isOwner) {
            return ctx.answerCallbackQuery({
                text: "Akses ditolak. Instance ini bukan milik akun kamu.",
                show_alert: true,
            });
        }

        await ctx.answerCallbackQuery();

        try {
            const details = await getInstanceDetails(instanceId);
            const publicIp = await getInstancePublicIp(instanceId);

            const keyboard = new InlineKeyboard();
            if (details.lifecycleState === "RUNNING") {
                keyboard.text("⏹️ Stop", `vps_action:STOP:${instanceId}`);
                keyboard.text("🔄 Restart", `vps_action:SOFTRESET:${instanceId}`);
            } else if (details.lifecycleState === "STOPPED") {
                keyboard.text("▶️ Start", `vps_action:START:${instanceId}`);
            }
            keyboard.row();
            keyboard.text("🗑️ Terminate (Hapus)", `vps_term_prompt:${instanceId}`);

            await ctx.editMessageText(
                [
                    `🖥️ *MANAJEMEN VPS: ${details.displayName}*`,
                    "",
                    `📊 *State:* \`${details.lifecycleState}\``,
                    `🌐 *Public IP:* \`${publicIp || "Tidak ada"}\``,
                    `⚙️ *Shape:* \`${details.shape}\``,
                    `🆔 *OCID:* \`${instanceId}\``,
                ].join("\n"),
                {
                    parse_mode: "Markdown",
                    reply_markup: keyboard,
                }
            );
        } catch (error) {
            await ctx.reply(`Gagal memuat instance: ${error.message}`);
        }
    });

    // Jalankan action (START, STOP, SOFTRESET)
    bot.callbackQuery(/^vps_action:(START|STOP|SOFTRESET):(.+)$/, async (ctx) => {
        const action = ctx.match[1];
        const instanceId = ctx.match[2];

        const isOwner = await verifyInstanceOwnership(instanceId, ctx.from.id);
        if (!isOwner) {
            return ctx.answerCallbackQuery({
                text: "Akses ditolak. Instance ini bukan milik akun kamu.",
                show_alert: true,
            });
        }

        await ctx.answerCallbackQuery({
            text: `Mengirim perintah ${action}...`,
        });

        try {
            await ctx.editMessageText(`Sedang mengirim perintah \`${action}\` ke Oracle Cloud...`, {
                parse_mode: "Markdown",
            });

            const updatedInstance = await performInstanceAction(instanceId, action);
            await updateInstanceState(instanceId, { instanceState: updatedInstance.lifecycleState });

            await ctx.editMessageText(
                [
                    `✅ *PERINTAH ${action} BERHASIL DIKIRIM!*`,
                    "",
                    `📌 *Instance:* \`${updatedInstance.displayName}\``,
                    `📊 *Status Baru:* \`${updatedInstance.lifecycleState}\``,
                    "",
                    "Status instance sedang diperbarui oleh OCI.",
                ].join("\n"),
                { parse_mode: "Markdown" }
            );
        } catch (error) {
            console.error(`[ACTION ERROR] ${action}:`, error);
            await ctx.editMessageText(`Gagal menjalankan perintah ${action}:\n${error.message}`);
        }
    });

    // Prompt konfirmasi terminate
    bot.callbackQuery(/^vps_term_prompt:(.+)$/, async (ctx) => {
        const instanceId = ctx.match[1];
        const isOwner = await verifyInstanceOwnership(instanceId, ctx.from.id);

        if (!isOwner) {
            return ctx.answerCallbackQuery({
                text: "Akses ditolak.",
                show_alert: true,
            });
        }

        await ctx.answerCallbackQuery();

        const keyboard = new InlineKeyboard()
            .text("⚠️ Ya, Hapus Permanen", `vps_term_confirm:${instanceId}`)
            .text("Batal", `vps_term_cancel:${instanceId}`);

        return ctx.editMessageText(
            [
                "⚠️ *KONFIRMASI TERMINASI VPS*",
                "",
                "Apakah kamu yakin ingin MENGHAPUS instance ini secara permanen?",
                "Semua data pada boot volume akan dihapus dan tidak dapat dipulihkan kembali.",
            ].join("\n"),
            {
                parse_mode: "Markdown",
                reply_markup: keyboard,
            }
        );
    });

    // Batal terminate
    bot.callbackQuery(/^vps_term_cancel:(.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery({ text: "Penghapusan dibatalkan." });
        return ctx.editMessageText("Penghapusan VPS dibatalkan.");
    });

    // Konfirmasi eksekusi terminate
    bot.callbackQuery(/^vps_term_confirm:(.+)$/, async (ctx) => {
        const instanceId = ctx.match[1];
        const isOwner = await verifyInstanceOwnership(instanceId, ctx.from.id);

        if (!isOwner) {
            return ctx.answerCallbackQuery({
                text: "Akses ditolak.",
                show_alert: true,
            });
        }

        await ctx.answerCallbackQuery({ text: "Memproses terminasi instance..." });

        try {
            await ctx.editMessageText("Sedang mengirim instruksi terminasi ke OCI...");

            await terminateVpsInstance(instanceId, false);
            await updateInstanceState(instanceId, { instanceState: "TERMINATED" });

            return ctx.editMessageText(
                [
                    "🗑️ *VPS BERHASIL DITERMINASI*",
                    "",
                    `🆔 *Instance OCID:* \`${instanceId}\``,
                    "📊 *Status:* `TERMINATING / TERMINATED`",
                    "",
                    "Instance telah dihapus dari Oracle Cloud.",
                ].join("\n"),
                { parse_mode: "Markdown" }
            );
        } catch (error) {
            console.error("[TERMINATE ERROR]", error);
            return ctx.editMessageText(`Gagal melakukan terminasi instance:\n${error.message}`);
        }
    });
}
