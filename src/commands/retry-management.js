
import { InlineKeyboard } from "grammy";

import {
    listActiveProvisioningJobs,
    findLatestProvisioningJob,
    cancelRetryJobByUser,
} from "../services/database/retry-management.repository.js";

const TIME_ZONE = "Asia/Jakarta";

function formatDate(date) {
    if (!date) return "-";

    return new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: TIME_ZONE,
    }).format(new Date(date));
}

function getStatusLabel(status) {
    const labels = {
        PENDING: "Menunggu",
        RETRYING: "Sedang retry",
        SUCCEEDED: "Berhasil",
        FAILED: "Gagal",
        CANCELLED: "Dibatalkan",
    };

    return labels[status] ?? status;
}

function formatJob(job) {
    return [
        `VPS: ${job.display_name}`,
        `Status: ${getStatusLabel(job.status)}`,
        `Attempt: ${job.attempt_count}/${job.max_attempts}`,
        `Next retry: ${formatDate(job.next_retry_at)}`,
        `Instance: ${job.instance_id ?? "-"}`,
        `State: ${job.instance_state ?? "-"}`,
        `Error: ${job.error_message ?? "-"}`,
        `Job ID: ${job.id}`,
    ].join("\n");
}

function getTelegramUserId(ctx) {
    return ctx.from?.id;
}

/**
 * Mendaftarkan retry management commands.
 */
export function registerRetryManagementCommands(bot) {
    // /retry_status
    bot.command("retry_status", async (ctx) => {
        const telegramUserId = getTelegramUserId(ctx);

        try {
            const activeJobs = await listActiveProvisioningJobs(
                telegramUserId,
                1
            );

            const job =
                activeJobs[0] ??
                await findLatestProvisioningJob(telegramUserId);

            if (!job) {
                return ctx.reply(
                    "Kamu belum memiliki provisioning job."
                );
            }

            return ctx.reply(
                `PROVISIONING STATUS\n\n${formatJob(job)}`
            );
        } catch (error) {
            console.error("[RETRY_STATUS ERROR]", error);

            return ctx.reply(
                "Gagal mengambil status provisioning. Silakan coba kembali."
            );
        }
    });

    // /retry_list
    bot.command("retry_list", async (ctx) => {
        const telegramUserId = getTelegramUserId(ctx);

        try {
            const jobs = await listActiveProvisioningJobs(
                telegramUserId,
                10
            );

            if (!jobs.length) {
                return ctx.reply(
                    "Tidak ada provisioning job aktif."
                );
            }

            const message = jobs
                .map((job, index) => {
                    return [
                        `${index + 1}. ${job.display_name}`,
                        `Status: ${getStatusLabel(job.status)}`,
                        `Attempt: ${job.attempt_count}/${job.max_attempts}`,
                        `Next retry: ${formatDate(job.next_retry_at)}`,
                        `Job ID: ${job.id}`,
                    ].join("\n");
                })
                .join("\n\n");

            return ctx.reply(
                `ACTIVE PROVISIONING JOBS (${jobs.length})\n\n${message}`
            );
        } catch (error) {
            console.error("[RETRY_LIST ERROR]", error);

            return ctx.reply(
                "Gagal mengambil daftar provisioning job. Silakan coba kembali."
            );
        }
    });

    // /cancel_retry
    bot.command("cancel_retry", async (ctx) => {
        const telegramUserId = getTelegramUserId(ctx);

        try {
            const jobs = await listActiveProvisioningJobs(
                telegramUserId,
                10
            );

            // Hanya job yang belum dikunci worker yang bisa dibatalkan.
            const cancellableJobs = jobs.filter(
                (job) => job.status === "PENDING" || job.status === "RETRYING"
            );

            if (!cancellableJobs.length) {
                return ctx.reply(
                    "Tidak ada job retry yang dapat dibatalkan.\n\n" +
                    "Job mungkin sedang diproses worker atau sudah selesai."
                );
            }

            const keyboard = new InlineKeyboard();

            for (const job of cancellableJobs) {
                keyboard.text(
                    `Cancel ${job.display_name} (${job.attempt_count}/${job.max_attempts})`,
                    `retry_cancel_confirm:${job.id}`
                ).row();
            }

            return ctx.reply(
                "Pilih provisioning job yang ingin dibatalkan:",
                {
                    reply_markup: keyboard,
                }
            );
        } catch (error) {
            console.error("[CANCEL_RETRY ERROR]", error);

            return ctx.reply(
                "Gagal mengambil provisioning job. Silakan coba kembali."
            );
        }
    });

    // Callback konfirmasi pembatalan
    bot.callbackQuery(/^retry_cancel_confirm:([0-9a-f-]+)$/i, async (ctx) => {
        const jobId = ctx.match[1];

        const keyboard = new InlineKeyboard()
            .text("Ya, batalkan", `retry_cancel_yes:${jobId}`)
            .text("Tidak", `retry_cancel_no:${jobId}`);

        await ctx.answerCallbackQuery();

        return ctx.editMessageText(
            "Apakah kamu yakin ingin membatalkan provisioning job ini?\n\n" +
            "Job yang dibatalkan tidak akan dijalankan kembali.",
            {
                reply_markup: keyboard,
            }
        );
    });

    // Callback batal konfirmasi
    bot.callbackQuery(/^retry_cancel_no:([0-9a-f-]+)$/i, async (ctx) => {
        await ctx.answerCallbackQuery({
            text: "Pembatalan diurungkan.",
        });

        return ctx.editMessageText(
            "Pembatalan provisioning diurungkan."
        );
    });

    // Callback final cancel
    bot.callbackQuery(/^retry_cancel_yes:([0-9a-f-]+)$/i, async (ctx) => {
        const jobId = ctx.match[1];
        const telegramUserId = getTelegramUserId(ctx);

        try {
            const cancelledJob = await cancelRetryJobByUser(
                jobId,
                telegramUserId
            );

            await ctx.answerCallbackQuery();

            if (!cancelledJob) {
                return ctx.editMessageText(
                    "Job tidak dapat dibatalkan.\n\n" +
                    "Job mungkin sudah diklaim worker, sudah selesai, " +
                    "atau bukan milik akun kamu."
                );
            }

            return ctx.editMessageText(
                `PROVISIONING CANCELLED\n\n` +
                `VPS: ${cancelledJob.display_name}\n` +
                `Status: ${getStatusLabel(cancelledJob.status)}\n` +
                `Attempt: ${cancelledJob.attempt_count}/${cancelledJob.max_attempts}\n` +
                `Job ID: ${cancelledJob.id}`
            );
        } catch (error) {
            console.error("[CANCEL_RETRY CALLBACK ERROR]", error);

            await ctx.answerCallbackQuery({
                text: "Gagal membatalkan job.",
            });

            return ctx.editMessageText(
                "Terjadi kesalahan ketika membatalkan provisioning job."
            );
        }
    });
}
