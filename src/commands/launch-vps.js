
import { randomUUID } from "node:crypto";
import { InlineKeyboard } from "grammy";

import { getVpsConfig } from "../config/vps.js";

import {
    createProvisioningJob,
} from "../services/database/provisioning.repository.js";

/**
 * Memastikan hanya admin yang dapat menggunakan perintah VPS.
 */
function isAuthorized(ctx) {
    const adminId = process.env.ALLOWED_TELEGRAM_USER_ID;

    return (
        adminId &&
        ctx.from?.id?.toString() === adminId.trim() &&
        ctx.chat?.type === "private"
    );
}

/**
 * Menjawab callback Telegram secara aman.
 *
 * Callback yang kedaluwarsa tidak boleh menghentikan
 * proses bisnis provisioning.
 */
async function safeAnswerCallbackQuery(ctx, options = {}) {
    try {
        await ctx.answerCallbackQuery(options);
    } catch (error) {
        console.warn("[BOT] Failed to answer callback query:", {
            message: error.message,
        });
    }
}

/**
 * Mengedit pesan Telegram tanpa memengaruhi
 * proses provisioning jika Telegram gagal.
 */
async function safeEditMessageText(ctx, text) {
    try {
        await ctx.editMessageText(text);
        return true;
    } catch (error) {
        console.warn("[BOT] Failed to edit Telegram message:", {
            message: error.message,
        });

        return false;
    }
}

/**
 * Mengirim pesan Telegram secara aman.
 *
 * Kegagalan notifikasi tidak boleh mengubah
 * status provisioning job.
 */
async function safeReply(ctx, text) {
    try {
        await ctx.reply(text);
        return true;
    } catch (error) {
        console.error("[BOT] Failed to send Telegram notification:", {
            message: error.message,
        });

        return false;
    }
}

/**
 * Menampilkan preview konfigurasi VPS.
 */
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
        console.error("[LAUNCH VPS PREVIEW ERROR]", {
            message: error.message,
        });

        await safeReply(
            ctx,
            "Gagal menyiapkan konfigurasi VPS. Silakan periksa konfigurasi aplikasi."
        );
    }
}

/**
 * Membuat provisioning job setelah admin mengonfirmasi.
 *
 * Fungsi ini TIDAK melakukan launch OCI secara langsung.
 * Seluruh proses provisioning dijalankan oleh Cron Worker.
 */
export async function confirmLaunchVps(ctx) {
    if (!isAuthorized(ctx)) {
        await safeAnswerCallbackQuery(ctx, {
            text: "Akses ditolak.",
            show_alert: true,
        });

        return;
    }

    const token = ctx.match?.[1];

    if (!token) {
        await safeAnswerCallbackQuery(ctx, {
            text: "Provisioning token tidak ditemukan.",
            show_alert: true,
        });

        return;
    }

    // Jawab callback secepat mungkin.
    // Kegagalan callback tidak menghentikan proses.
    await safeAnswerCallbackQuery(ctx, {
        text: "Permintaan provisioning diterima.",
    });

    try {
        const vps = getVpsConfig();

        // Simpan snapshot konfigurasi agar retry
        // menggunakan konfigurasi yang sama.
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

        // Buat job terlebih dahulu.
        // Database harus menjamin retry_token unik
        // agar callback yang sama tidak membuat job ganda.
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

        const job = result?.job;

        if (!job) {
            throw new Error("Gagal menyimpan provisioning job.");
        }

        // Callback yang sama sudah pernah membuat job.
        if (!result.created) {
            await safeEditMessageText(
                ctx,
                [
                    "PROVISIONING REQUEST ALREADY EXISTS",
                    "",
                    `Job ID: ${job.id}`,
                    `Status: ${job.status}`,
                    `Attempt: ${job.attempt_count}/${job.max_attempts}`,
                    "",
                    "Permintaan ini sudah pernah dibuat.",
                    "Sistem tidak membuat instance baru dari callback ini.",
                ].join("\n")
            );

            return;
        }

        // Job sudah masuk database dan menunggu worker.
        await safeEditMessageText(
            ctx,
            [
                "VPS PROVISIONING REQUEST QUEUED",
                "",
                `Job ID: ${job.id}`,
                `Name: ${job.display_name ?? vps.displayName}`,
                `Shape: ${job.shape}`,
                `Status: ${job.status}`,
                "",
                "Permintaan provisioning berhasil disimpan.",
                "",
                "Cron Worker akan memproses job secara otomatis.",
                "Mohon tunggu notifikasi hasil provisioning.",
            ].join("\n")
        );

        console.info("[PROVISIONING] Job queued successfully:", {
            jobId: job.id,
            status: job.status,
        });
    } catch (error) {
        console.error("[PROVISIONING CREATE ERROR]", {
            message: error.message,
        });

        await safeEditMessageText(
            ctx,
            [
                "PROVISIONING REQUEST FAILED",
                "",
                "Gagal menyimpan permintaan provisioning.",
                "Silakan periksa log aplikasi dan database.",
                "",
                "Jangan melakukan konfirmasi ulang sebelum",
                "memastikan apakah job sudah tersimpan.",
            ].join("\n")
        );
    }
}

/**
 * Membatalkan konfirmasi sebelum provisioning job dibuat.
 */
export async function cancelLaunchVps(ctx) {
    if (!isAuthorized(ctx)) {
        await safeAnswerCallbackQuery(ctx, {
            text: "Akses ditolak.",
            show_alert: true,
        });

        return;
    }

    await safeAnswerCallbackQuery(ctx, {
        text: "Konfirmasi provisioning dibatalkan.",
    });

    await safeEditMessageText(
        ctx,
        "VPS provisioning dibatalkan. Tidak ada provisioning job yang dibuat."
    );
}
