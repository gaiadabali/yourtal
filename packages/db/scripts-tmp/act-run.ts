import pg from "pg";
import { runDemoActivity } from "../src/seed/demo-world/activity";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
console.log(await runDemoActivity(pool, { apiBaseUrl: "http://127.0.0.1:26471", password: "demo-local-only-password-1" }, console.log));
await pool.end();
