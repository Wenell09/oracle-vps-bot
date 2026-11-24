import { Pool } from "pg";

const connectionString =
    process.env.DATABASE_URL ||
    (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL
        ? "postgres://dummy:dummy@localhost:5432/dummy"
        : null);

if (!connectionString && process.env.NODE_ENV !== "test") {
    throw new Error("DATABASE_URL is not configured");
}

export const db = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === "test" ? false : {
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
