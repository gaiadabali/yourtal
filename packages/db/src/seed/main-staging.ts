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
 * fallback for anything secret, and runs every deploy — see
 * `seedStaging`'s own header: the world (businesses/campaigns/accounts)
 * seeds once and is then left alone, but the marketing funding and the
 * tier-0 pending grant are checked and completed on EVERY run, so a
 * previous run's partial failure (staging's own first run: an unfunded
 * marketing budget left the grant missing) is finished by the next one
 * instead of skipped forever.
 *
 * The ledger is always up during pre-reload on staging (it is a separate,
 * long-running systemd unit — `infra/HELIOS.md` — not rebuilt or restarted
 * by this release), so any failure from it here is real and this exits
 * non-zero: `infra/helios/pre-reload.sh` runs under `set -Eeuo pipefail`,
 * so a non-zero exit here fails the whole deploy, leaving the previous
 * release serving — the same reasoning that script's own header gives for
 * every step in it.
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

    const worldSummary =
      result.world === "seeded"
        ? `world: seeded (${String(result.businesses)} businesses, ${String(result.campaigns)} campaigns, ${String(result.accounts)} demo accounts)`
        : "world: already present";
    const grantSummary =
      result.pendingGrantDetail === undefined
        ? `tier-0 pending grant: ${result.pendingGrant}`
        : `tier-0 pending grant: ${result.pendingGrant}: ${result.pendingGrantDetail}`;
    console.log(
      `Staging seed — ${worldSummary}; marketing funding: ${result.marketingFunding}; ${grantSummary}.`,
    );

    if (result.pendingGrant === "failed") {
      // set -Eeuo pipefail in infra/helios/pre-reload.sh turns this into a
      // failed deploy, on purpose — see this file's own header.
      console.error(
        "Staging seed: the tier-0 pending grant failed (see the line above). Failing the deploy " +
          "rather than leaving it silently missing a second time.",
      );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

await main();
