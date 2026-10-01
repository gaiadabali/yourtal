import pg from "pg";
import { DemoApi, loginAs } from "../src/seed/demo-world/api-client";
import { watch } from "../src/seed/demo-world/activity";
import { campaignIdFor } from "../src/seed/demo-world/world";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
const { api } = await loginAs(new DemoApi("http://127.0.0.1:26471"), "teen.au@demo.yourtal.test", "demo-local-only-password-1");
console.log(await watch(pool, api, campaignIdFor("au-laneway-threads", "styling")));
await pool.end();
