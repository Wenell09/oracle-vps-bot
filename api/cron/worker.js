import workerHandler from "../worker.js";

/**
 * Dedicated Cron Worker Endpoint: /api/cron/worker
 *
 * Dirancang khusus untuk eksekusi berkala via External Scheduler (seperti cron-job.org):
 * - Menerima HTTP GET (dan POST).
 * - Mengotentikasi request menggunakan CRON_SECRET via header Authorization: Bearer <CRON_SECRET>.
 * - Menolak request dengan query parameters yang mencoba mengirim rahasia/token di URL.
 * - Memanggil /api/worker menggunakan HTTP POST dengan header Authorization: Bearer <WORKER_SECRET>.
 * - Menambahkan header x-vercel-protection-bypass untuk melewati Vercel Deployment Protection
 *   pada internal worker request menggunakan VERCEL_AUTOMATION_BYPASS_SECRET.
 * - Memprioritaskan APP_URL (stable production URL) daripada VERCEL_URL (generated deployment URL)
 *   untuk menghindari HTTP 401 pada protected deployments.
 * - Menjaga WORKER_SECRET, CRON_SECRET, dan VERCEL_AUTOMATION_BYPASS_SECRET tetap aman dan
 *   tidak pernah diekspor ke response atau log.
 * - Tidak menduplikasi logika provisioning OCI/database worker.
 * - Mendukung fallback eksekusi in-process jika container serverless memblokir HTTP loopback internal.
 */

/**
 * Resolve the stable base URL for internal worker calls.
 *
 * Priority:
 *   1. APP_URL env var  – explicit stable production URL (preferred).
 *   2. x-forwarded-host / host request header – derived from the inbound request.
 *   3. http://localhost:3000 – local development fallback.
 *
 * VERCEL_URL is intentionally excluded because it resolves to the generated
 * deployment URL, which is covered by Vercel Deployment Protection and will
 * return HTTP 401 for internal requests even when the bypass secret is set.
 */
function resolveBaseUrl(req) {
    if (process.env.APP_URL) {
        return process.env.APP_URL;
    }

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";

    if (host) {
        return `${proto}://${host}`;
    }

    return "http://localhost:3000";
}

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
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
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

    // 4. Resolve stable production URL – never use VERCEL_URL (generated deployment URL)
    //    because it is protected and returns HTTP 401 for internal requests.
    const baseUrl = resolveBaseUrl(req);
    const workerUrl = `${baseUrl.replace(/\/$/, "")}/api/worker`;

    // 5. Build internal request headers.
    //    Always include WORKER_SECRET for /api/worker authentication.
    //    Add x-vercel-protection-bypass when VERCEL_AUTOMATION_BYPASS_SECRET is configured
    //    so that Vercel Deployment Protection is bypassed for this internal automation call.
    const internalHeaders = {
        Authorization: `Bearer ${workerSecret}`,
        "Content-Type": "application/json",
    };

    if (bypassSecret) {
        internalHeaders["x-vercel-protection-bypass"] = bypassSecret;
    }

    // 6. Panggil worker endpoint yang sudah ada via HTTP POST
    try {
        const response = await fetch(workerUrl, {
            method: "POST",
            headers: internalHeaders,
        });

        const data = await response.json().catch(() => null);

        // Log status only – never log secrets or the full response body in production
        console.log("[EXTERNAL CRON] Worker response status:", response.status);

        if (!response.ok) {
            console.error("[EXTERNAL CRON] Worker returned HTTP error:", response.status);
        }

        return res.status(response.status).json({
            success: response.ok,
            workerStatus: response.status,
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
                    const workerOk = (this.statusCode || 200) < 400;
                    if (!workerOk) {
                        console.error("[EXTERNAL CRON] In-process worker returned error status:", this.statusCode);
                    }
                    return res.status(this.statusCode || 200).json({
                        success: workerOk,
                        delegatedInProcess: true,
                        workerResult: body,
                    });
                }
            },
        };

        try {
            await workerHandler(simulatedReq, simulatedRes);
        } catch (workerError) {
            console.error("[EXTERNAL CRON ERROR] Worker delegation failed:", workerError.message);
            return res.status(500).json({
                success: false,
                message: "Cron execution failed during worker processing.",
            });
        }
    }
}
