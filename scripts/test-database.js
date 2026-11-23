import "../src/config/env.js";
import { testDatabaseConnection, db } from "../src/config/database.js";

try {
    const result = await testDatabaseConnection();

    console.log("[DATABASE] Connection successful");
    console.log("Connected:", result.connected);
    console.log("Time:", result.currentTime);
} catch (error) {
    console.error("[DATABASE] Connection failed:", error.message);
    process.exitCode = 1;
} finally {
    await db.end();
}