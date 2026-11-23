import { randomUUID } from "node:crypto";
import { InlineKeyboard } from "grammy";
import { getVpsConfig } from "../config/vps.js";
import { launchVps } from "../services/oci/instance.service.js";

function isAuthorized(ctx) {
    const adminId = process.env.TELEGRAM_ADMIN_ID;

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
            `Region: ap-batam-1`,
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

        const instance = await launchVps(token);

        await ctx.reply(
            [
                "VPS LAUNCH REQUEST ACCEPTED",
                "",
                `Name: ${instance.displayName}`,
                `Instance OCID: ${instance.id}`,
                `Shape: ${instance.shape}`,
                `Status: ${instance.lifecycleState}`,
                "",
                "Instance sedang diproses OCI.",
                "Public IP akan diperiksa setelah instance siap.",
            ].join("\n")
        );
    } catch (error) {
        console.error("[LAUNCH VPS ERROR]", error);

        await ctx.reply(
            [
                "VPS LAUNCH FAILED",
                "",
                `Error: ${error.message}`,
                "",
                "Belum ada konfirmasi bahwa instance berhasil dibuat.",
                "Periksa daftar instance OCI sebelum mencoba kembali.",
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

    await ctx.editMessageText("VPS provisioning dibatalkan. Tidak ada permintaan launch yang dikirim.");
}