import workerHandler from "./worker.js";

/**
 * Vercel Cron Endpoint: /api/cron
 *
 * Sesuai spesifikasi Vercel Cron:
 * - Vercel Cron memanggil endpoint menggunakan HTTP GET.
 * - Header Authorization: Bearer <CRON_SECRET> disertakan jika CRON_SECRET dikonfigurasi.
 * - Endpoint ini mengotorisasi panggilan Vercel Cron, lalu memanggil worker endpoint
 *   menggunakan HTTP POST dengan WORKER_SECRET.
 * - Tidak mengekspos rahasia melalui query parameter.
 */
export default async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed. Use GET (for cron) or POST.",
        });
    }

    // Pastikan rahasia tidak dikirimkan di query string
    if (req.query?.secret || req.query?.worker_secret || req.query?.cron_secret) {
        return res.status(400).json({
            success: false,
            message: "Secrets in query parameters are strictly forbidden.",
        });
    }

    const cronSecret = process.env.CRON_SECRET;
    const workerSecret = process.env.WORKER_SECRET;
    const authHeader = req.headers.authorization;

    // Validasi otorisasi cron
    const isAuthorized =
        (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
        (workerSecret && authHeader === `Bearer ${workerSecret}`) ||
        (!cronSecret && !workerSecret); // Dev only fallback jika belum dikonfigurasi

    if (!isAuthorized) {
        console.warn("[CRON] Unauthorized invocation attempt");
        return res.status(401).json({
            success: false,
            message: "Unauthorized cron invocation.",
        });
    }

    console.log("[CRON] Scheduler triggered at:", new Date().toISOString());

    // Panggil worker endpoint yang sudah ada.
    // Tentukan base URL worker
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const baseUrl =
        process.env.APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        (host ? `${proto}://${host}` : "http://localhost:3000");

    const workerUrl = `${baseUrl.replace(/\/$/, "")}/api/worker`;

    try {
        // Coba invoke worker melalui HTTP POST dengan WORKER_SECRET
        const response = await fetch(workerUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${workerSecret}`,
                "Content-Type": "application/json",
            },
        });

        const data = await response.json().catch(() => null);

        console.log("[CRON] Worker response status:", response.status, data);

        return res.status(response.status).json({
            success: response.ok,
            invokedUrl: workerUrl,
            workerResponse: data,
        });
    } catch (fetchError) {
        console.warn(
            "[CRON] Direct HTTP fetch to worker failed, delegating in-process to worker handler:",
            fetchError.message
        );

        // Fallback in-process execution jika HTTP loopback tidak dapat dicapai di serverless container
        const simulatedReq = {
            method: "POST",
            headers: {
                authorization: `Bearer ${workerSecret}`,
            },
        };

        let responseSent = false;
        const simulatedRes = {
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(body) {
                if (!responseSent) {
                    responseSent = true;
                    return res.status(this.statusCode || 200).json({
                        success: true,
                        delegatedInProcess: true,
                        workerResult: body,
                    });
                }
            },
        };

        try {
            await workerHandler(simulatedReq, simulatedRes);
        } catch (workerError) {
            console.error("[CRON ERROR] Worker delegation failed:", workerError);
            return res.status(500).json({
                success: false,
                message: "Cron execution failed during worker processing.",
                error: workerError.message,
            });
        }
    }
}
