import workerCronHandler from "./cron/worker.js";

/**
 * Backward compatibility alias for /api/cron -> delegating to /api/cron/worker
 */
export default async function handler(req, res) {
    return workerCronHandler(req, res);
}
