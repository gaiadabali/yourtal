import pg from "pg";
import { runDemoActivity } from "./demo-world/activity";
import { resetDemoWorld } from "./demo-world/reset";

/**
 * `pnpm demo:reset` (13.1.a): run locally from the repo root, or on Helios as
 * `node api/dist/demo-reset.js` with app.env loaded. `--no-activity` skips the
 * first day of history. Same variables and dev defaults as the staging seed.
 */
async function main(): Promise<void> {
  const env = process.env;
  const connectionString = env["DATABASE_OWNER_URL"];
  const password = env["STAGING_DEMO_PASSWORD"];
  if (connectionString === undefined || password === undefined || password.length === 0) {
    console.error("demo:reset needs DATABASE_OWNER_URL and STAGING_DEMO_PASSWORD.");
    process.exitCode = 1;
    return;
  }
  const ledger = {
    baseUrl: env["LEDGER_BASE_URL"] ?? "http://127.0.0.1:26910",
    serviceSecret: env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real",
  };
  const voucher = {
    baseUrl: env["VOUCHER_BASE_URL"] ?? "http://voucher:8080",
    serviceSecret: env["VOUCHER_SERVICE_SECRET"] ?? "local-only-voucher-service-secret-not-real",
  };
  const siteUrl = env["SITE_URL"] ?? "http://127.0.0.1:26310";
  const pool = new pg.Pool({ connectionString });
  try {
    const result = await resetDemoWorld(pool, { ledger, voucher, password, siteUrl }, console.log);
    console.log(
      `demo:reset — ${String(result.world.campaigns)} demo campaigns, ${String(result.world.listings)} listings, ` +
        `${String(result.funded)} newly funded, ${String(result.logins.length)} logins`,
    );
    for (const failure of result.fundingFailures) console.error(`  funding failed: ${failure}`);
    if (!process.argv.includes("--no-activity")) {
      const apiBaseUrl = env["DEMO_API_BASE_URL"] ?? `http://127.0.0.1:${env["PORT"] ?? "3001"}`;
      const summary = await runDemoActivity(pool, { apiBaseUrl, password }, console.log);
      console.log(`demo:activity — ${summary}`);
    }
  } finally {
    await pool.end();
  }
}

await main();
