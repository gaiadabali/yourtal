import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { listDemoMediaBusinesses, runDemoMedia } from "@yourtal/media/demo-media";
import type { DemoMediaResult } from "@yourtal/media/demo-media";
import { runDemoCampaignFunding } from "./demo-campaign-funding";
import type { DemoCampaignFundingResult } from "./demo-campaign-funding";
import { runDemoMediaVouchers } from "./demo-media-vouchers";
import type { DemoMediaVoucherResult } from "./demo-media-vouchers";
import { seedStaging } from "./staging";
import { ensureStagingMedia } from "./staging-media";

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
 * The ledger AND the voucher service (2.3.c's own dependency: the demo
 * voucher `ensureDemoVoucher` mints) are always up during pre-reload on
 * staging (separate, long-running systemd units — `infra/HELIOS.md` — not
 * rebuilt or restarted by this release), so any failure from either here
 * is real and this exits non-zero: `infra/helios/pre-reload.sh` runs under
 * `set -Eeuo pipefail`, so a non-zero exit here fails the whole deploy,
 * leaving the previous release serving — the same reasoning that script's
 * own header gives for every step in it.
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

  // Same dev defaults `apps/api/src/config/env.schema.ts` gives these four —
  // real values come from `/opt/yourtal/secrets/app.env` on Helios (2.1.f).
  const ledgerBaseUrl = process.env.LEDGER_BASE_URL ?? "http://127.0.0.1:26910";
  const ledgerServiceSecret =
    process.env.LEDGER_SERVICE_SECRET ?? "local-only-ledger-service-secret-not-real";
  const voucherBaseUrl = process.env.VOUCHER_BASE_URL ?? "http://voucher:8080";
  const voucherServiceSecret =
    process.env.VOUCHER_SERVICE_SECRET ?? "local-only-voucher-service-secret-not-real";

  const pool = new Pool({ connectionString });
  try {
    const result = await seedStaging(pool, {
      demoPassword,
      ledger: { baseUrl: ledgerBaseUrl, serviceSecret: ledgerServiceSecret },
      voucher: { baseUrl: voucherBaseUrl, serviceSecret: voucherServiceSecret },
    });

    const worldSummary =
      result.world === "seeded"
        ? `world: seeded (${String(result.businesses)} businesses, ${String(result.campaigns)} campaigns, ${String(result.accounts)} demo accounts)`
        : "world: already present";
    const grantSummary =
      result.pendingGrantDetail === undefined
        ? `tier-0 pending grant: ${result.pendingGrant}`
        : `tier-0 pending grant: ${result.pendingGrant}: ${result.pendingGrantDetail}`;
    const voucherSummary =
      result.demoVoucherDetail === undefined
        ? `demo voucher: ${result.demoVoucher}`
        : `demo voucher: ${result.demoVoucher}: ${result.demoVoucherDetail}`;
    // F74/8.2.i (reopened): one line per region's cheap listing.
    const affordableListingsSummary =
      result.affordableListings.length === 0
        ? "affordable listings: skipped"
        : result.affordableListings
            .map((l) =>
              l.detail === undefined
                ? `${l.region} affordable listing (${l.listingId}): ${l.status}`
                : `${l.region} affordable listing (${l.listingId}): ${l.status}: ${l.detail}`,
            )
            .join("; ");
    // F74/8.2.i: one line per region this run had a viewer for.
    const redemptionBalanceSummary =
      result.redemptionBalance.length === 0
        ? "redemption balance: skipped"
        : result.redemptionBalance
            .map((b) =>
              b.detail === undefined
                ? `${b.region} redemption balance: ${b.status} (${String(b.availablePoints)}/${String(b.targetPoints)})`
                : `${b.region} redemption balance: ${b.status}: ${b.detail}`,
            )
            .join("; ");
    // 2.3.i: only where a fixture ships (the Helios release sets
    // MEDIA_FIXTURE_DIR); a laptop publishes its own with packages/media.
    const fixtureDir = process.env.MEDIA_FIXTURE_DIR;
    const media =
      fixtureDir === undefined || fixtureDir === ""
        ? null
        : await ensureStagingMedia({
            fixtureDir,
            assetId: "attention-30s",
            bucket: process.env.S3_BUCKET ?? "yourtal-media",
            endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:26900",
            accessKeyId: process.env.S3_ACCESS_KEY ?? "",
            secretAccessKey: process.env.S3_SECRET_KEY ?? "",
          });
    const mediaSummary =
      media === null
        ? "demo video: skipped"
        : media.detail === undefined
          ? `demo video: ${media.status} (${String(media.uploaded)}/${String(media.total)} uploaded)`
          : `demo video: ${media.status}: ${media.detail}`;

    // TASKS.md 7.2.d/e: the demo media kit's own campaigns (8 AU + 8 ID),
    // real ffmpeg/RustFS, idempotent by campaign id — a re-run after the
    // first successful one just checks 16 rows and does nothing further.
    //
    // Deliberately NEVER fails the deploy (unlike pendingGrant/demoVoucher/
    // media above, which gate real reward/voucher correctness): this step
    // depends on two hosts this platform does not operate
    // (download.blender.org, upload.wikimedia.org) plus ffmpeg/CPU time,
    // and a transient failure in any one of 16 cosmetic demo campaigns must
    // never hold every future deploy hostage — the exact failure mode a
    // path bug in this same step caused earlier (F51). Caught here too, on
    // top of runDemoMedia's own per-campaign try/catch, so a bug that
    // throws instead of returning a "failed" result still can't fail main().
    let demoMediaResults: readonly DemoMediaResult[] = [];
    try {
      demoMediaResults = await runDemoMedia({ databaseUrl: connectionString, log: console.log });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`[seed:staging] demo media threw rather than returning results: ${detail}`);
    }
    const demoMediaSeeded = demoMediaResults.filter(
      (r: DemoMediaResult) => r.status === "seeded",
    ).length;
    // F65-adjacent: a row written with the old, relative media URLs gets its
    // URLs rewritten in place here, not skipped — see demo-media.ts's own
    // `isAbsoluteUrl` check for why "already has an hls_url" was never
    // enough on its own.
    const demoMediaRepaired = demoMediaResults.filter(
      (r: DemoMediaResult) => r.status === "repaired",
    ).length;
    const demoMediaFailed = demoMediaResults.filter((r: DemoMediaResult) => r.status === "failed");
    const demoMediaAlready =
      demoMediaResults.length - demoMediaSeeded - demoMediaRepaired - demoMediaFailed.length;
    const demoMediaSummary =
      demoMediaFailed.length > 0
        ? `demo media: ${String(demoMediaSeeded)} seeded, ${String(demoMediaRepaired)} repaired, ${String(demoMediaFailed.length)} FAILED (${demoMediaFailed.map((r: DemoMediaResult) => r.slug).join(", ")}) — not failing the deploy over it`
        : `demo media: ${String(demoMediaSeeded)} seeded, ${String(demoMediaRepaired)} repaired, ${String(demoMediaAlready)} already present`;

    // TASKS.md 11.4.h: every campaign (the 4 Snap App fixtures `seedStaging`
    // creates, plus the 16 demo-media campaigns `runDemoMedia` just did) gets
    // a real ledger allocation and a `campaign.reward_config` row, or the
    // feed (`fetchFundedCampaigns`) shows nothing. MUST run after
    // `runDemoMedia`, not inside `seedStaging` — the demo-media campaigns
    // don't exist until the call just above. A real ledger call, same as
    // `pendingGrant`/`demoVoucher` above (not the 16-cosmetic-campaigns
    // non-fatal treatment `demoMediaSummary` gets): a failure here means the
    // home feed stays empty, so it fails the deploy loudly too.
    let demoCampaignFundingResults: readonly DemoCampaignFundingResult[] = [];
    try {
      demoCampaignFundingResults = await runDemoCampaignFunding(
        pool,
        { baseUrl: ledgerBaseUrl, serviceSecret: ledgerServiceSecret },
        console.log,
      );
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(
        `[seed:staging] demo campaign funding threw rather than returning results: ${detail}`,
      );
      demoCampaignFundingResults = [{ campaignId: "n/a", title: "n/a", region: "AU", status: "failed", detail }];
    }
    const demoCampaignFundingFailed = demoCampaignFundingResults.filter(
      (r) => r.status === "failed",
    );
    const demoCampaignFundingSummary =
      demoCampaignFundingResults.length === 0
        ? "demo campaign funding: nothing to fund (all campaigns already funded)"
        : `demo campaign funding: ${String(demoCampaignFundingResults.length - demoCampaignFundingFailed.length)} funded, ${String(demoCampaignFundingFailed.length)} FAILED`;

    // TASKS.md 7.2.e: each of the 16 demo-media businesses above gets one
    // real store listing plus 6 real vouchers, minted through the ledger's
    // real pricing route and the voucher service's real batch/approve path
    // (demo-media-vouchers.ts) — never seed/store.ts's mock generator, which
    // mints no decryptable code. Same non-fatal reasoning as demoMediaSummary
    // just above: a transient failure in one of 16 cosmetic listings must
    // never hold the deploy hostage, but must be loud, not silent.
    let demoMediaVoucherResults: readonly DemoMediaVoucherResult[] = [];
    try {
      demoMediaVoucherResults = await runDemoMediaVouchers(
        pool,
        listDemoMediaBusinesses(),
        { baseUrl: ledgerBaseUrl, serviceSecret: ledgerServiceSecret },
        { baseUrl: voucherBaseUrl, serviceSecret: voucherServiceSecret },
        console.log,
      );
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(
        `[seed:staging] demo media vouchers threw rather than returning results: ${detail}`,
      );
    }
    const demoMediaVouchersSeeded = demoMediaVoucherResults.filter(
      (r: DemoMediaVoucherResult) => r.status === "seeded",
    ).length;
    const demoMediaVouchersFailed = demoMediaVoucherResults.filter(
      (r: DemoMediaVoucherResult) => r.status === "failed",
    );
    const demoMediaVouchersSummary =
      demoMediaVouchersFailed.length > 0
        ? `demo media vouchers: ${String(demoMediaVouchersSeeded)} seeded, ${String(demoMediaVouchersFailed.length)} FAILED (${demoMediaVouchersFailed.map((r: DemoMediaVoucherResult) => r.slug).join(", ")}) — not failing the deploy over it`
        : `demo media vouchers: ${String(demoMediaVouchersSeeded)} seeded, ${String(demoMediaVoucherResults.length - demoMediaVouchersSeeded)} already present`;

    console.log(
      `Staging seed — ${worldSummary}; marketing funding: ${result.marketingFunding}; ` +
        `${grantSummary}; ${voucherSummary}; ${affordableListingsSummary}; ` +
        `${redemptionBalanceSummary}; ${mediaSummary}; ${demoMediaSummary}; ` +
        `${demoCampaignFundingSummary}; ${demoMediaVouchersSummary}.`,
    );

    if (
      result.pendingGrant === "failed" ||
      result.demoVoucher === "failed" ||
      result.affordableListings.some((l) => l.status === "failed") ||
      result.redemptionBalance.some((b) => b.status === "failed") ||
      media?.status === "failed" ||
      demoCampaignFundingFailed.length > 0
    ) {
      // set -Eeuo pipefail in infra/helios/pre-reload.sh turns this into a
      // failed deploy, on purpose — see this file's own header.
      console.error(
        "Staging seed: a real service call failed (see the line(s) above). Failing the deploy " +
          "rather than leaving a demo grant, voucher, listing, redemption balance or video " +
          "silently missing.",
      );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

await main();
