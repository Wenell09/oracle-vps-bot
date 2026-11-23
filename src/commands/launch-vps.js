import { randomUUID } from "node:crypto";
import { InlineKeyboard } from "grammy";

import { getVpsConfig } from "../config/vps.js";
import { launchVps } from "../services/oci/instance.service.js";

import {
    createProvisioningJob,
    startInitialProvisioningAttempt,
    markProvisioningSucceeded,
} from "../services/database/provisioning.repository.js";

import {
    handleProvisioningFailure,
} from "../services/oci/retry.service.js";

function isAuthorized(ctx) {
    const adminId = process.env.ALLOWED_TELEGRAM_USER_ID;

    return (
        adminId &&
        ctx.from?.id?.toString() === adminId.trim() &&
        ctx.chat?.type === "private"
    );
}

export async function launchVpsCommand(ctx) {
    if (!isAuthorized(ctx)) {
        return ctx.reply("Akses ditolak.");
    }

    try {
        const vps = getVpsConfig();
        const token = randomUUID();

        const message = [
            "VPS PROVISIONING PREVIEW",
            "",
            `Name: ${vps.displayName}`,
            "Region: ap-batam-1",
            `Availability Domain: ${vps.availabilityDomain}`,
            `Shape: ${vps.shape}`,
            `OCPU: ${vps.ocpus}`,
            `Memory: ${vps.memoryInGBs} GB`,
            `Boot Volume: ${vps.bootVolumeSizeInGBs} GB`,
            "OS: Ubuntu 24.04 ARM64",
            "Public IPv4: Enabled",
            "",
            "PERHATIAN:",
            "Tindakan ini akan membuat instance OCI.",
            "Pastikan konfigurasi dan potensi biaya sudah diperiksa.",
            "",
            "Apakah kamu yakin ingin membuat VPS?",
        ].join("\n");

        const keyboard = new InlineKeyboard()
            .text("Konfirmasi Launch VPS", `launch_vps:${token}`)
            .text("Batalkan", `cancel_vps:${token}`);

        await ctx.reply(message, {
            reply_markup: keyboard,
        });
    } catch (error) {
        console.error("[LAUNCH VPS PREVIEW ERROR]", error);

        await ctx.reply(
            `Gagal menyiapkan konfigurasi VPS.\nError: ${error.message}`
        );
    }
}

export async function confirmLaunchVps(ctx) {
    if (!isAuthorized(ctx)) {
        return ctx.answerCallbackQuery({
            text: "Akses ditolak.",
            show_alert: true,
        });
    }

    const token = ctx.match?.[1];

    if (!token) {
        return ctx.answerCallbackQuery({
            text: "Provisioning token tidak ditemukan.",
            show_alert: true,
        });
    }

    await ctx.answerCallbackQuery({
        text: "Memproses provisioning VPS...",
    });

    try {
        await ctx.editMessageText(
            "Sedang mengirim permintaan provisioning ke OCI...\nMohon jangan tekan tombol berulang kali."
        );

        const vps = getVpsConfig();

        // Simpan snapshot konfigurasi agar retry konsisten.
        const config = {
            compartmentId: vps.compartmentId,
            availabilityDomain: vps.availabilityDomain,
            imageId: vps.imageId,
            subnetId: vps.subnetId,
            sshPublicKey: vps.sshPublicKey,
            displayName: vps.displayName,
            shape: vps.shape,
            ocpus: vps.ocpus,
            memoryInGBs: vps.memoryInGBs,
            bootVolumeSizeInGBs: vps.bootVolumeSizeInGBs,
        };

        // Buat job terlebih dahulu sebelum memanggil OCI.
        const result = await createProvisioningJob({
            telegramUserId: ctx.from.id,
            telegramChatId: ctx.chat.id,
            displayName: vps.displayName,
            shape: vps.shape,
            availabilityDomain: vps.availabilityDomain,
            config,
            retryToken: token,
            maxAttempts: 20,
        });

        const job = result.job;

        if (!job) {
            throw new Error("Gagal menyimpan provisioning job.");
        }

        // Callback yang sama tidak boleh meluncurkan instance dua kali.
        if (!result.created) {
            await ctx.reply(
                [
                    "PROVISIONING REQUEST ALREADY EXISTS",
                    "",
                    `Job ID: ${job.id}`,
                    `Status: ${job.status}`,
                    `Attempt: ${job.attempt_count}/${job.max_attempts}`,
                    "",
                    "Permintaan ini sudah pernah diproses.",
                ].join("\n")
            );
            return;
        }

        // Catat percobaan pertama.
        const attemptedJob = await startInitialProvisioningAttempt(job.id);

        if (!attemptedJob) {
            throw new Error("Gagal mencatat percobaan provisioning pertama.");
        }

        try {
            let instance;

            try {
                instance = await launchVps(
                    token,
                    attemptedJob.config
                );
            } catch (error) {
                console.error("[OCI LAUNCH ERROR]", error);

                const result = await handleProvisioningFailure(
                    attemptedJob,
                    error
                );

                if (result.retryScheduled) {
                    await ctx.reply(
                        [
                            "VPS PROVISIONING RETRY SCHEDULED",
                            "",
                            `Job ID: ${job.id}`,
                            `Status: ${result.status}`,
                            `Attempt: ${result.attemptCount}/${result.maxAttempts}`,
                            `Next retry: ${new Date(result.nextRetryAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
                            `Retry interval: ${result.delayMinutes} menit`,
                            "",
                            `Error: ${error.message}`,
                            "",
                            "Sistem akan mencoba kembali sesuai jadwal.",
                        ].join("\n")
                    );
                } else {
                    await ctx.reply(
                        [
                            "VPS PROVISIONING FAILED",
                            "",
                            `Job ID: ${job.id}`,
                            `Status: ${result.status}`,
                            `Reason: ${result.reason}`,
                            `Error: ${error.message}`,
                            "",
                            "Tidak ada retry otomatis untuk error ini.",
                        ].join("\n")
                    );
                }

                return;
            }

            // Bagian ini hanya dijalankan jika OCI mengembalikan instance.
            const updatedJob = await markProvisioningSucceeded(job.id, {
                instanceId: instance.id,
                instanceState: instance.lifecycleState,
            });

            if (!updatedJob) {
                console.error(
                    "[DATABASE] Instance created but provisioning status was not updated.",
                    { jobId: job.id, instanceId: instance.id }
                );

                await ctx.reply(
                    [
                        "VPS CREATED - DATABASE UPDATE FAILED",
                        "",
                        `Job ID: ${job.id}`,
                        `Instance OCID: ${instance.id}`,
                        "",
                        "Instance berhasil dibuat oleh OCI, tetapi status database gagal diperbarui.",
                        "Jangan melakukan launch ulang. Periksa OCI Console.",
                    ].join("\n")
                );

                return;
            }

            await ctx.reply(
                [
                    "VPS LAUNCH SUCCESS",
                    "",
                    `Job ID: ${job.id}`,
                    `Name: ${instance.displayName}`,
                    `Instance OCID: ${instance.id}`,
                    `Shape: ${instance.shape}`,
                    `Status: ${instance.lifecycleState}`,
                    "",
                    "Instance berhasil dikirim ke OCI.",
                ].join("\n")
            );
        } catch (error) {
            console.error("[OCI LAUNCH ERROR]", error);

            const result = await handleProvisioningFailure(
                attemptedJob,
                error
            );

            if (result.retryScheduled) {
                await ctx.reply(
                    [
                        "VPS PROVISIONING RETRY SCHEDULED",
                        "",
                        `Job ID: ${job.id}`,
                        `Status: ${result.status}`,
                        `Attempt: ${result.attemptCount}/${result.maxAttempts}`,
                        `Next retry: ${new Date(result.nextRetryAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
                        `Retry interval: ${result.delayMinutes} menit`,
                        "",
                        `Error: ${error.message}`,
                        "",
                        "Sistem akan mencoba kembali sesuai jadwal.",
                    ].join("\n")
                );
            } else {
                await ctx.reply(
                    [
                        "VPS PROVISIONING FAILED",
                        "",
                        `Job ID: ${job.id}`,
                        `Status: ${result.status}`,
                        `Reason: ${result.reason}`,
                        `Error: ${error.message}`,
                        "",
                        "Tidak ada retry otomatis untuk error ini.",
                    ].join("\n")
                );
            }
        }
    } catch (error) {
        console.error("[PROVISIONING ERROR]", error);

        await ctx.reply(
            [
                "PROVISIONING PROCESS ERROR",
                "",
                `Error: ${error.message}`,
                "",
                "Periksa database dan daftar instance OCI sebelum mencoba kembali.",
            ].join("\n")
        );
    }
}

export async function cancelLaunchVps(ctx) {
    if (!isAuthorized(ctx)) {
        return ctx.answerCallbackQuery({
            text: "Akses ditolak.",
            show_alert: true,
        });
    }

    await ctx.answerCallbackQuery({
        text: "Provisioning dibatalkan.",
    });

    await ctx.editMessageText(
        "VPS provisioning dibatalkan. Tidak ada permintaan launch yang dikirim."
    );
}