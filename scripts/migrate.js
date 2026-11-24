import "../src/config/env.js";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../src/config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                migration_name VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        const migrationsDir = path.join(__dirname, "../src/database/migrations");
        const files = await fs.readdir(migrationsDir);
        const sqlFiles = files
            .filter((file) => file.endsWith(".sql"))
            .sort();

        for (const file of sqlFiles) {
            const migrationName = path.basename(file, ".sql");

            const existing = await client.query(
                `SELECT id FROM schema_migrations WHERE migration_name = $1`,
                [migrationName]
            );

            if (existing.rowCount > 0) {
                console.log(`[MIGRATION] Already executed: ${migrationName}`);
                continue;
            }

            console.log(`[MIGRATION] Executing: ${migrationName}...`);
            const filePath = path.join(migrationsDir, file);
            const sql = await fs.readFile(filePath, "utf8");

            await client.query(sql);

            await client.query(
                `INSERT INTO schema_migrations (migration_name) VALUES ($1)`,
                [migrationName]
            );

            console.log(`[MIGRATION] Successfully executed: ${migrationName}`);
        }

        await client.query("COMMIT");
        console.log("[MIGRATION] All migrations applied successfully.");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations()
        .then(() => db.end())
        .catch((error) => {
            console.error("[MIGRATION] Failed:", error.message);
            db.end().finally(() => {
                process.exit(1);
            });
        });
}
