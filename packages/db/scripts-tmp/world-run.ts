import pg from "pg";
import { ensureDemoWorld } from "../src/seed/demo-world/world.ts";
const env = process.env;
const pool = new pg.Pool({ connectionString: env.DATABASE_OWNER_URL });
await ensureDemoWorld(pool, { baseUrl: env.LEDGER_BASE_URL!, serviceSecret: env.LEDGER_SERVICE_SECRET! }, { baseUrl: env.VOUCHER_BASE_URL!, serviceSecret: env.VOUCHER_SERVICE_SECRET! }, console.log);
await pool.end();
