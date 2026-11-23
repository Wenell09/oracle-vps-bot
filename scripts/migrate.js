import "../src/config/env.js";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../src/config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationName = "001_create_provisioning_jobs";

async function migrate() {
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

        const existing = await client.query(
            `SELECT id FROM schema_migrations WHERE migration_name = $1`,
            [migrationName]
        );

        if (existing.rowCount > 0) {
            console.log(`[MIGRATION] Already executed: ${migrationName}`);
            await client.query("COMMIT");
            return;
        }

        const migrationPath = path.join(
            __dirname,
            "../src/database/migrations/001_create_provisioning_jobs.sql"
        );

        const sql = await fs.readFile(migrationPath, "utf8");

        await client.query(sql);

        await client.query(
            `INSERT INTO schema_migrations (migration_name) VALUES ($1)`,
            [migrationName]
        );

        await client.query("COMMIT");

        console.log(`[MIGRATION] Successfully executed: ${migrationName}`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await db.end();
    }
}

migrate().catch((error) => {
    console.error("[MIGRATION] Failed:", error.message);
    process.exitCode = 1;
});