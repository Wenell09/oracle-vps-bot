import workerHandler from "../worker.js";

/**
 * Dedicated Cron Worker Endpoint: /api/cron/worker
 *
 * Dirancang khusus untuk eksekusi berkala via External Scheduler (seperti cron-job.org):
 * - Menerima HTTP GET (dan POST).
 * - Mengotentikasi request menggunakan CRON_SECRET via header Authorization: Bearer <CRON_SECRET>.
 * - Menolak request dengan query parameters yang mencoba mengirim rahasia/token di URL.
 * - Memanggil /api/worker menggunakan HTTP POST dengan header Authorization: Bearer <WORKER_SECRET>.
 * - Menjaga WORKER_SECRET internal tetap aman dan terpisah dari CRON_SECRET eksternal.
 * - Tidak menduplikasi logika provisioning OCI/database worker.
 * - Mendukung fallback eksekusi in-process jika container serverless memblokir HTTP loopback internal.
 */
export default async function handler(req, res) {
    // 1. Validasi HTTP Method (Menerima GET dan POST)
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed. Use GET (for cron trigger) or POST.",
        });
    }

    // 2. Cegah kebocoran secret di URL query string
    if (req.query?.secret || req.query?.worker_secret || req.query?.cron_secret || req.query?.token) {
        return res.status(400).json({
            success: false,
            message: "Secrets in query parameters are strictly forbidden.",
        });
    }

    // 3. Autentikasi menggunakan CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    const workerSecret = process.env.WORKER_SECRET;
    const authHeader = req.headers.authorization;

    const isAuthorized =
        (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
        (workerSecret && authHeader === `Bearer ${workerSecret}`) ||
        (!cronSecret && !workerSecret && process.env.NODE_ENV === "test");

    if (!isAuthorized) {
        console.warn("[EXTERNAL CRON] Unauthorized cron invocation attempt");
        return res.status(401).json({
            success: false,
            message: "Unauthorized cron invocation. Provide a valid Bearer token.",
        });
    }

    console.log("[EXTERNAL CRON] Scheduler triggered at:", new Date().toISOString());

    // 4. Panggil worker endpoint yang sudah ada via HTTP POST
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const baseUrl =
        process.env.APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        (host ? `${proto}://${host}` : "http://localhost:3000");

    const workerUrl = `${baseUrl.replace(/\/$/, "")}/api/worker`;

    try {
        const response = await fetch(workerUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${workerSecret}`,
                "Content-Type": "application/json",
            },
        });

        const data = await response.json().catch(() => null);

        console.log("[EXTERNAL CRON] Worker response status:", response.status, data);

        return res.status(response.status).json({
            success: response.ok,
            invokedUrl: workerUrl,
            workerResponse: data,
        });
    } catch (fetchError) {
        console.warn(
            "[EXTERNAL CRON] Direct HTTP loopback fetch to worker failed, delegating in-process to worker handler:",
            fetchError.message
        );

        // Fallback in-process execution jika container serverless membatasi panggilan loopback HTTP sendiri
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
            console.error("[EXTERNAL CRON ERROR] Worker delegation failed:", workerError);
            return res.status(500).json({
                success: false,
                message: "Cron execution failed during worker processing.",
                error: workerError.message,
            });
        }
    }
}
