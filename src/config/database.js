import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
}

export const db = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ssl: {
        rejectUnauthorized: false,
    },
});

db.on("error", (error) => {
    console.error("[DATABASE] Unexpected pool error:", error);
});

export async function testDatabaseConnection() {
    const client = await db.connect();

    try {
        const result = await client.query("SELECT NOW() AS current_time");

        return {
            connected: true,
            currentTime: result.rows[0].current_time,
        };
    } finally {
        client.release();
    }
}