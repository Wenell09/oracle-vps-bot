export async function startCommand(ctx) {
    const message = `
🤖 *Selamat datang di Oracle VPS Bot!*

Bot ini membantu kamu membuat, memantau, dan mengelola VPS Oracle Cloud Infrastructure (OCI) secara otomatis dan andal.

📌 *Perintah Utama:*
• /create - Buat VPS baru
• /status - Cek status real-time & kelola VPS
• /list   - Daftar semua VPS kamu
• /delete - Hapus (terminate) VPS dengan konfirmasi

🔍 *Diagnostik & OCI:*
• /oci_test       - Uji koneksi ke Oracle Cloud
• /list_shapes    - Daftar VM shapes yang tersedia
• /list_images    - Daftar OS images
• /network_check  - Periksa kesiapan VCN & Subnet
• /quota_check    - Periksa kuota compute

🔄 *Retry & Provisioning:*
• /retry_status   - Status provisioning job terakhir
• /retry_list     - Daftar job provisioning aktif
• /cancel_retry   - Batalkan antrean retry

ℹ️ *Lainnya:*
• /help - Tampilkan bantuan
• /ping - Periksa koneksi bot
• /id   - Tampilkan ID Telegram kamu
`;

    await ctx.reply(message, { parse_mode: "Markdown" });
}
