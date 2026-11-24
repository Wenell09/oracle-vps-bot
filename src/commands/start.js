export async function startCommand(ctx) {
    const message = `
🤖 <b>Selamat datang di Oracle VPS Bot!</b>

Bot ini membantu kamu membuat, memantau, dan mengelola VPS Oracle Cloud Infrastructure (OCI) secara otomatis dan andal.

📌 <b>Perintah Utama:</b>
• /create - Buat VPS baru
• /status - Cek status real-time & kelola VPS
• /list - Daftar semua VPS kamu
• /delete - Hapus (terminate) VPS dengan konfirmasi

🔍 <b>Diagnostik & OCI:</b>
• /oci_test - Uji koneksi ke Oracle Cloud
• /list_shapes - Daftar VM shapes yang tersedia
• /list_images - Daftar OS images
• /network_check - Periksa kesiapan VCN & Subnet
• /quota_check - Periksa kuota compute

🔄 <b>Retry & Provisioning:</b>
• /retry_status - Status provisioning job terakhir
• /retry_list - Daftar job provisioning aktif
• /cancel_retry - Batalkan antrean retry

ℹ️ <b>Lainnya:</b>
• /help - Tampilkan bantuan
• /ping - Periksa koneksi bot
• /id - Tampilkan ID Telegram kamu
`.trim();

    await ctx.reply(message, { parse_mode: "HTML" });
}
