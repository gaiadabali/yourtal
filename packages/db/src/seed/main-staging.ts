import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { seedStaging } from "./staging";

/**
 * CLI entry point for the staging seed (2.3.e) — the pre-reload step calls
 * this, once, right after migrations apply and before the api/worker
 * processes restart:
 *
 *   node apps/api/dist/seed-staging.js
 *
 * Built by `node scripts/build-service.mjs seed` into `apps/api/dist`
 * (alongside `main.js`), NOT `packages/db/dist-seed` — see this file's
 * sibling `staging.ts` and this ticket's own report for why: the Helios
 * release's `node_modules` lives under `apps/api`, not `packages/db`, so a
 * bundle that has to resolve `pg`/`@node-rs/argon2` (a native addon esbuild
 * cannot bundle, only reference) at runtime has to live somewhere Node's
 * module resolution finds them — `apps/api/dist` already does, because
 * `main.js` needs the exact same things.
 *
 * Kept as its own file rather than added to `seed.ts`'s `main()`: that one
 * is the LOCAL dev seed (mock generators, `pnpm --filter @yourtal/db
 * seed`), reads `.env` by design, and is meant to be re-run freely. This
 * one is a deployment step, reads real environment variables with no
 * fallback for anything secret, and refuses to run twice (see
 * `seedStaging`'s own header on the emptiness guard).
 */

const { Pool } = pg;

/** Same convenience `seed.ts` gives `DATABASE_OWNER_URL` for local runs —
 * pnpm does not load `.env`, so a bare `node packages/db/dist-seed/...`
 * from a checkout would otherwise need the variable exported by hand. On
 * Helios the variable is already in the process environment (from
 * `/opt/yourtal/secrets/app.env`, loaded by the systemd unit), so this
 * never reads a file there. Nothing else below gets this treatment: a
 * demo password or a service secret with a file-based fallback is a
 * secret with a place to accidentally commit it.
 */
function resolveDatabaseOwnerUrl(): string | undefined {
  if (process.env.DATABASE_OWNER_URL !== undefined) return process.env.DATABASE_OWNER_URL;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const envFile = path.join(repoRoot, ".env");
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*DATABASE_OWNER_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const connectionString = resolveDatabaseOwnerUrl();
  if (connectionString === undefined) {
    console.error("No DATABASE_OWNER_URL. Refusing to run the staging seed.");
    process.exitCode = 1;
    return;
  }

  // No default, ever — a demo password baked into this file is a demo
  // password every reader of the (public, F6) repository already holds.
  const demoPassword = process.env.STAGING_DEMO_PASSWORD;
  if (demoPassword === undefined || demoPassword.length === 0) {
    console.error(
      "STAGING_DEMO_PASSWORD is not set. Refusing to run the staging seed rather than " +
        "invent or hard-code a password for every demo account.",
    );
    process.exitCode = 1;
    return;
  }

  // Same dev defaults `apps/api/src/config/env.schema.ts` gives these two —
  // real values come from `/opt/yourtal/secrets/app.env` on Helios (2.1.f).
  const ledgerBaseUrl = process.env.LEDGER_BASE_URL ?? "http://127.0.0.1:26910";
  const ledgerServiceSecret =
    process.env.LEDGER_SERVICE_SECRET ?? "local-only-ledger-service-secret-not-real";

  const pool = new Pool({ connectionString });
  try {
    const result = await seedStaging(pool, {
      demoPassword,
      ledger: { baseUrl: ledgerBaseUrl, serviceSecret: ledgerServiceSecret },
    });
    if (result.skipped) {
      console.log("Staging seed skipped: identity.user_profile already has rows.");
      return;
    }
    console.log(
      `Staging seed: ${String(result.businesses)} businesses, ${String(result.campaigns)} campaigns, ` +
        `${String(result.accounts)} demo accounts, tier-0 pending grant: ${result.pendingGrant}.`,
    );
  } finally {
    await pool.end();
  }
}

await main();
