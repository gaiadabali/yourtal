import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";

/**
 * TASKS.md 9.2.c's full Check: "the listing's stock rises by exactly the
 * batch size" -- store.listings.stock_remaining (7.4.c) is a live read of
 * `voucher.vouchers` in state='minted', a table only the REAL voucher
 * service can write (`yourtal_app` has SELECT-only there since
 * 20260920000019_voucher_lifecycle.sql). `FakeVoucherClient` -- what
 * staff-voucher-batch-review.e2e.test.ts runs against for speed -- never
 * touches that table at all (`platform.voucher_fake_batch` instead), so
 * "mints through 4.5" is provable against it but "stock rises" is not.
 *
 * This file builds and boots real `services/ledger` and `services/voucher`
 * binaries (mirroring `scripts/voucher-contract-live.mjs`, 1.2.e -- that
 * script is Area A's; this file is self-contained rather than depending on
 * it, since `scripts/**` is out of this module's area) and flips
 * `LEDGER_MODE=live` for THIS process before compiling `AppModule`, so the
 * store module's own `VOUCHER_INTERNAL_CLIENT` (via `WalletModule`) is a
 * real `HttpVoucherClient` for the whole run.
 *
 * Gated behind `VOUCHER_BATCH_LIVE=1` and run alone (not part of `pnpm
 * check`/`apps/api`'s ordinary `pnpm test`, same as `checkout.live.test.ts`'s
 * own `CHECKOUT_LIVE`):
 *
 *   set -a && . ./.env && set +a
 *   VOUCHER_BATCH_LIVE=1 pnpm exec node ../../packages/db/scripts/with-test-db.mjs -- \
 *     vitest run src/modules/store/staff-voucher-batch-review.live.test.ts
 *
 * (from apps/api; `with-test-db.mjs` is what sets VOUCHER_DATABASE_URL and
 * LEDGER_DATABASE_URL to the same fresh yourtal_test_* database DATABASE_URL
 * gets, which both Go binaries below connect to directly.)
 */
const live = process.env["VOUCHER_BATCH_LIVE"] === "1";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

let app: NestFastifyApplication;
let ledger: ChildProcess | undefined;
let voucher: ChildProcess | undefined;
let scratch: string;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function start(
  name: "ledger" | "voucher",
  exe: string,
  env: Record<string, string>,
  readyPath: string,
): Promise<{ url: string; child: ChildProcess }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${String(port)}`;
  const logPath = path.join(scratch, `${name}.log`);
  const child = spawn(exe, [], {
    env: { ...process.env, ...env, [`${name.toUpperCase()}_ADDR`]: `127.0.0.1:${String(port)}` },
    stdio: ["ignore", openSync(logPath, "w"), "inherit"],
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(`${url}${readyPath}`).then(
      (r) => r.ok,
      () => false,
    );
    if (ready) return { url, child };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the ${name} service never became ready -- see ${logPath}`);
}

beforeAll(async () => {
  if (!live) return;
  if (!/yourtal_test_/.test(process.env["VOUCHER_DATABASE_URL"] ?? "")) {
    throw new Error(
      "staff-voucher-batch-review.live.test.ts: run me through packages/db/scripts/with-test-db.mjs",
    );
  }

  scratch = mkdtempSync(path.join(tmpdir(), "voucher-batch-live-"));
  const exe = (name: string) =>
    path.join(scratch, process.platform === "win32" ? `${name}.exe` : name);
  for (const name of ["voucher", "ledger"]) {
    const build = spawnSync("go", ["build", "-o", exe(name), `./cmd/${name}`], {
      cwd: path.join(repoRoot, `services/${name}`),
      stdio: "inherit",
    });
    if (build.status !== 0) throw new Error(`go build ./cmd/${name} failed`);
  }

  const keyDir = path.join(scratch, "keys");
  mkdirSync(keyDir);
  for (const purpose of ["voucher_code", "merchant_hmac", "voucher_qr"]) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(keyDir, `${purpose}.v1.key`), randomBytes(32).toString("hex"));
  }

  const ledgerSecret = "local-only-ledger-service-secret-not-real";
  const voucherSecret = "local-only-voucher-service-secret-not-real";
  const ledgerStarted = await start(
    "ledger",
    exe("ledger"),
    {
      LEDGER_SERVICE_SECRET: ledgerSecret,
      REWARD_ATTESTATION_SECRET: "local-only-reward-attestation-secret-not-real",
    },
    "/readyz",
  );
  ledger = ledgerStarted.child;
  const voucherStarted = await start(
    "voucher",
    exe("voucher"),
    {
      VOUCHER_SERVICE_SECRET: voucherSecret,
      VOUCHER_KEY_DIR: keyDir,
      LEDGER_BASE_URL: ledgerStarted.url,
      LEDGER_SERVICE_SECRET: ledgerSecret,
    },
    "/healthz",
  );
  voucher = voucherStarted.child;

  // Flip THIS process to live mode before AppModule reads it via
  // loadAppConfig() -- see createVoucherClient.ts/createLedgerClient.ts.
  process.env["LEDGER_MODE"] = "live";
  process.env["LEDGER_BASE_URL"] = ledgerStarted.url;
  process.env["LEDGER_SERVICE_SECRET"] = ledgerSecret;
  process.env["VOUCHER_BASE_URL"] = voucherStarted.url;
  process.env["VOUCHER_SERVICE_SECRET"] = voucherSecret;

  const { AppModule } = await import("../../app.module");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);

afterAll(async () => {
  if (!live) return;
  await app.close();
  ledger?.kill("SIGKILL");
  voucher?.kill("SIGKILL");
});

async function createBusiness(ownerCookie: string): Promise<string> {
  const handle = `voucher-batch-live-${randomUUID().slice(0, 8)}`;
  const created = await app.inject({
    method: "POST",
    url: "/api/businesses",
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: {
      legalName: `9.2.c Live Test Co ${handle}`,
      displayName: "9.2.c Live Test Business",
      taxIdKind: "ABN",
      taxIdValue: "12345678901",
      addressState: "NSW",
      addressPostcode: "2000",
      roles: ["advertiser", "supplier"],
      region: "AU",
      handle,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json<{ business: { id: string } }>().business.id;
}

async function createListing(
  ownerCookie: string,
  businessId: string,
  stockTotal: number,
): Promise<string> {
  const location = await app.inject({
    method: "POST",
    url: `/api/${businessId}/store/locations`,
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: { name: "Live Test Outlet", address: "1 Test St", district: "Testville" },
  });
  expect(location.statusCode, location.body).toBe(201);
  const locationId = location.json<{ id: string }>().id;

  const listing = await app.inject({
    method: "POST",
    url: `/api/${businessId}/store/listings`,
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: {
      merchantName: "9.2.c Live Test Business",
      title: "9.2.c Live Test Listing",
      description: "Exercises the real stock-rises Check against the live voucher engine.",
      category: "retail",
      locationIds: [locationId],
      faceValueMinor: 10_000,
      settlementValueMinor: 3_000,
      stockTotal,
      transferable: false,
      partialRedemptionPolicy: "single_use_forfeit",
      minimumSpendMinor: null,
      expiresAt: "2027-01-01T00:00:00.000Z",
      status: "available",
      audience: "all_ages",
      contentCategory: "food-and-drink",
      imageUrl: "https://cdn.example.com/listing.jpg",
      channel: "in_store",
      partialRedemption: "single_use",
    },
  });
  expect(listing.statusCode, listing.body).toBe(201);
  return listing.json<{ id: string }>().id;
}

async function stockRemainingOf(ownerCookie: string, businessId: string, listingId: string) {
  const got = await app.inject({
    method: "GET",
    url: `/api/${businessId}/store/listings/${listingId}`,
    headers: { cookie: ownerCookie },
  });
  expect(got.statusCode, got.body).toBe(200);
  return got.json<{ stockRemaining: number }>().stockRemaining;
}

describe.skipIf(!live)("9.2.c against the live voucher engine", () => {
  it("approving a voucher-batch request mints it, and the listing's stock rises by exactly the batch size", async () => {
    const businessOwner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(ownerPool(), staff.userId, "moderator");

    const businessId = await createBusiness(businessOwner.cookie);
    const listingId = await createListing(businessOwner.cookie, businessId, 10);

    expect(await stockRemainingOf(businessOwner.cookie, businessId, listingId)).toBe(0);

    const quantity = 5;
    const requested = await app.inject({
      method: "POST",
      url: `/api/${businessId}/store/voucher-batch-requests`,
      headers: { cookie: businessOwner.cookie, "idempotency-key": randomUUID() },
      payload: { listingId, quantity, reason: "restocking for a promotion" },
    });
    expect(requested.statusCode, requested.body).toBe(201);
    const requestId = requested.json<{ id: string }>().id;

    // Still zero: a pending request mints nothing (7.4.c).
    expect(await stockRemainingOf(businessOwner.cookie, businessId, listingId)).toBe(0);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/voucher-batches/${requestId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "stock request looks legitimate" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const approvedBody = approved.json<{ state: string; mintedBatchId: string | null }>();
    expect(approvedBody.state).toBe("approved");
    expect(approvedBody.mintedBatchId).not.toBeNull();

    expect(await stockRemainingOf(businessOwner.cookie, businessId, listingId)).toBe(quantity);
  });
});
