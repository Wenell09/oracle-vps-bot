export async function helpCommand(ctx) {
    const message = `
📖 <b>PANDUAN PERINTAH BOT</b>

<b>Manajemen VPS:</b>
• /create - Mulai konfigurasi dan buat VPS baru
• /status - Lihat status real-time VPS aktif (Start/Stop/Restart)
• /list - Tampilkan semua instance VPS milik kamu
• /delete - Hapus instance VPS (dengan konfirmasi keamanan)

<b>Diagnostik OCI:</b>
• /oci_test - Uji koneksi & autentikasi OCI
• /list_vps - Ambil daftar mentah instance OCI dari compartment
• /list_shapes - Lihat daftar shapes compute
• /list_images - Lihat daftar OS images
• /list_vcns - Lihat Virtual Cloud Networks
• /list_subnets - Lihat Subnets
• /network_check - Audit kesiapan network OCI (Gateway, Route, SSH)
• /quota_check - Periksa limit kuota OCI

<b>Antrean & Retry:</b>
• /retry_status - Cek status job antrean provisioning
• /retry_list - Lihat semua job yang sedang antre/retry
• /cancel_retry - Batalkan job yang belum dieksekusi worker

<b>Utilitas:</b>
• /start - Menu utama
• /help - Tampilkan bantuan ini
• /ping - Periksa ketersediaan bot
• /id - Dapatkan ID Telegram kamu
`.trim();

    await ctx.reply(message, { parse_mode: "HTML" });
}
