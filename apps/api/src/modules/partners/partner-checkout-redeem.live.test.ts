import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutQuoteSchema, checkoutResultSchema } from "@yourtal/contracts/checkout/checkout";
import { toMinorUnits } from "@yourtal/contracts/money";
import { sql } from "drizzle-orm";
import { AppModule } from "../../app.module";
import { createAppDb, type AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { SAGA_DEPS } from "../checkout/checkout.tokens";
import type { SagaDeps } from "../checkout/use-cases/run-saga";
import { DrizzleCounterDeviceRepository } from "../devices/persistence/drizzle-counter-device.repository";
import { businessAccounts } from "../business/persistence/schema/business-account.table";
import { merchantLocations } from "../store/persistence/schema/listing.table";
import { issueDeviceCredential, issuePairingCode } from "../devices/crypto/device-token";
import { partnerCredentials } from "./persistence/schema/partner.table";

/**
 * TASKS.md 8.4.b's Check, end to end against the live ledger and voucher
 * services (same pattern checkout.live.test.ts/scripts/checkout-live.mjs
 * already establish for 4.7.d): a simulated snap-app links an account
 * (5.4.c), earns receipt points through the real POST /api/partners/actions
 * (8.4.a), buys through the real POST /api/checkout, and redeems the
 * resulting voucher through the real paired-device counter (8.2.h) — in
 * both regions.
 *
 * Self-contained rather than reusing scripts/checkout-live.mjs (Area A's
 * path): builds and spawns its OWN ledger and voucher binaries in
 * beforeAll/afterAll, the same way checkout.live.test.ts spawns its own
 * voucher process mid-suite. Gated behind the SAME CHECKOUT_LIVE=1 flag
 * apps/api/vitest.config.ts already reads to decide whether *.live.test.ts
 * files are excluded — one flag for every live-services test in this app,
 * not a second one this file would otherwise need its own config-file
 * change for.
 *
 * Run it:
 *   node packages/db/scripts/with-test-db.mjs -- \
 *     env CHECKOUT_LIVE=1 pnpm --filter @yourtal/api exec vitest run \
 *     src/modules/partners/partner-checkout-redeem.live.test.ts
 */
const live = process.env["CHECKOUT_LIVE"] === "1";

let app: NestFastifyApplication;
let deps: SagaDeps;
let owner: AppDb;
let ledger: ChildProcess | undefined;
let voucher: ChildProcess | undefined;

async function healthy(url: string): Promise<boolean> {
  return fetch(`${url}/healthz`).then(
    (r) => r.ok,
    () => false,
  );
}

beforeAll(async () => {
  if (!live) return;
  for (const name of ["LEDGER_DATABASE_URL", "VOUCHER_DATABASE_URL"]) {
    if (!/yourtal_test_/.test(process.env[name] ?? "")) {
      throw new Error(
        "partner-checkout-redeem.live.test.ts: run me through packages/db/scripts/with-test-db.mjs",
      );
    }
  }
  const root = path.resolve(process.cwd(), "..", "..");
  const scratch = mkdtempSync(path.join(tmpdir(), "partner-checkout-live-"));
  const exe = process.platform === "win32" ? ".exe" : "";
  const secrets = {
    ledger: process.env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real",
    voucher: process.env["VOUCHER_SERVICE_SECRET"] ?? "local-only-voucher-service-secret-not-real",
    attestation:
      process.env["REWARD_ATTESTATION_SECRET"] ?? "local-only-reward-attestation-secret-not-real",
  };
  const binaries: Record<string, string> = {};
  for (const service of ["ledger", "voucher"]) {
    binaries[service] = path.join(scratch, `${service}${exe}`);
    const build = spawnSync("go", ["build", "-o", binaries[service], `./cmd/${service}`], {
      cwd: path.join(root, "services", service),
      stdio: "inherit",
    });
    if (build.status !== 0) throw new Error(`building ${service} failed`);
  }
  const keyDir = path.join(scratch, "keys");
  mkdirSync(keyDir);
  for (const purpose of ["voucher_code", "merchant_hmac", "voucher_qr"]) {
    writeFileSync(path.join(keyDir, `${purpose}.v1.key`), randomBytes(32).toString("hex"));
  }

  const freePort = (): Promise<number> =>
    new Promise((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });
  const ledgerPort = await freePort();
  const voucherPort = await freePort();
  const ledgerUrl = `http://127.0.0.1:${ledgerPort}`;
  const voucherUrl = `http://127.0.0.1:${voucherPort}`;

  ledger = spawn(binaries["ledger"]!, [], {
    env: {
      ...process.env,
      LEDGER_ADDR: `127.0.0.1:${ledgerPort}`,
      LEDGER_SERVICE_SECRET: secrets.ledger,
      REWARD_ATTESTATION_SECRET: secrets.attestation,
    },
    stdio: ["ignore", openSync(path.join(scratch, "ledger.log"), "w"), "inherit"],
  });
  voucher = spawn(binaries["voucher"]!, [], {
    env: {
      ...process.env,
      VOUCHER_ADDR: `127.0.0.1:${voucherPort}`,
      VOUCHER_SERVICE_SECRET: secrets.voucher,
      VOUCHER_KEY_DIR: keyDir,
      LEDGER_BASE_URL: ledgerUrl,
      LEDGER_SERVICE_SECRET: secrets.ledger,
    },
    stdio: ["ignore", openSync(path.join(scratch, "voucher.log"), "w"), "inherit"],
  });
  for (const url of [ledgerUrl, voucherUrl]) {
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      ready = await healthy(url);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`${url} never became ready`);
  }

  process.env["LEDGER_MODE"] = "live";
  process.env["LEDGER_BASE_URL"] = ledgerUrl;
  process.env["VOUCHER_BASE_URL"] = voucherUrl;
  process.env["LEDGER_SERVICE_SECRET"] = secrets.ledger;
  process.env["VOUCHER_SERVICE_SECRET"] = secrets.voucher;
  process.env["REWARD_ATTESTATION_SECRET"] = secrets.attestation;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  deps = app.get(SAGA_DEPS);
  owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

  for (const region of ["AU", "ID"] as const) {
    const funded = await deps.ledger.fundMarketing({
      region,
      amountMinor: toMinorUnits(region === "AU" ? 500_000 : 50_000_000),
      proposedBy: "staff-1",
      approvedBy: "staff-2",
    });
    expect(funded.isOk()).toBe(true);
  }
}, 120_000);

afterAll(async () => {
  if (!live) return;
  await app.close();
  for (const child of [voucher, ledger]) {
    if (child === undefined) continue;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
  }
});

async function seedPartner(): Promise<{ partnerId: string; secret: string }> {
  const partnerId = `test-partner-${randomUUID()}`;
  const secret = `test-only-partner-secret-${randomUUID()}`;
  await owner.insert(partnerCredentials).values({ partnerId, secret });
  return { partnerId, secret };
}

function signedPartnerHeaders(partnerId: string, secret: string, rawBody: string) {
  const signature = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return {
    authorization: `Partner ${partnerId}:${signature}`,
    "content-type": "application/json",
    "idempotency-key": randomUUID(),
  };
}

/** A cheap, buyable listing in `region`, priced in the ledger and stocked by an approved batch. */
async function listing(region: "AU" | "ID"): Promise<{ listingId: string; merchantId: string }> {
  const listingId = randomUUID();
  const merchantId = randomUUID();
  const locationId = randomUUID();
  const currency = region === "AU" ? "AUD" : "IDR";
  // Cheap enough that ONE receipt scan (10 AU / 100 ID) covers it.
  const settlement = region === "AU" ? 30 : 600;
  const face = settlement * 2;
  await owner.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points,
       stock_remaining, stock_total, transferable, partial_redemption_policy,
       minimum_spend_minor, expires_at, status, lifecycle_state, currency, region, audience,
       content_category, image_url, channel, partial_redemption)
    VALUES (${listingId}, ${merchantId}, '8.4.b Test Merchant', '8.4.b Test Listing',
            'seeded for partner-checkout-redeem.live.test.ts', 'food-and-drink',
            ${face}, ${settlement}, 1, 3, 3, false, 'single_use_forfeit',
            NULL, now() + interval '90 days', 'available', 'active', ${currency}, ${region},
            'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg',
            'in_store', 'single_use')`);
  await owner.execute(sql`
    INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
    VALUES (${locationId}, ${merchantId}, '8.4.b Test Branch', '1 Test St', 'Test District')`);
  await owner.execute(sql`
    INSERT INTO store.listing_location (listing_id, location_id) VALUES (${listingId}, ${locationId})`);
  const priced = await deps.ledger.priceListing({
    listingId,
    region,
    currency,
    settlementMinor: toMinorUnits(settlement),
  });
  expect(priced.isOk()).toBe(true);
  const batch = (
    await deps.vouchers.requestBatch({
      listingId,
      merchantId,
      currency,
      faceValueMinor: toMinorUnits(face),
      quantity: 3,
      partialRedemptionPolicy: "single_use_forfeit",
      requestedBy: "staff-1",
    })
  )._unsafeUnwrap();
  (
    await deps.vouchers.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" })
  )._unsafeUnwrap();
  return { listingId, merchantId };
}

async function seedBusinessAndLocation(
  merchantId: string,
  region: "AU" | "ID",
): Promise<{ businessId: string; locationId: string }> {
  const businessId = merchantId; // the checkout-side merchantId IS the business id, same as 4.5.d
  await owner.insert(businessAccounts).values({
    id: businessId,
    legalName: "8.4.b Test Business",
    displayName: "8.4.b Test Business",
    taxIdKind: region === "AU" ? "ABN" : "NPWP",
    taxIdValue: "12345678901",
    addressState: region === "AU" ? "NSW" : null,
    addressPostcode: region === "AU" ? "2000" : null,
    addressCity: region === "AU" ? null : "Jakarta",
    roles: ["redeemer"],
    region,
    currency: region === "AU" ? "AUD" : "IDR",
    handle: `biz-8-4-b-${randomUUID().slice(0, 8)}`,
  });
  const locationId = randomUUID();
  await owner.insert(merchantLocations).values({
    id: locationId,
    merchantId: businessId,
    name: "8.4.b Test Store",
    address: "1 Test St",
    district: "Test District",
  });
  return { businessId, locationId };
}

async function provisionAndPairDevice(
  devices: DrizzleCounterDeviceRepository,
  businessId: string,
  locationId: string,
  region: "AU" | "ID",
): Promise<{ deviceId: string; secret: string }> {
  const { hash: argon2Hash } = await import("@node-rs/argon2");
  const pinHash = await argon2Hash("4242");
  const pairing = issuePairingCode();
  const device = await devices.create({
    businessId,
    region,
    locationId,
    label: "8.4.b Front counter",
    pinHash,
    pairingCodeHash: pairing.hash,
    pairingExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    createdBy: "test-owner",
  });
  const credential = issueDeviceCredential();
  const paired = await devices.pair(device.id, credential.hash, new Date());
  if (paired === null) throw new Error("pairing failed in test setup");
  return { deviceId: device.id, secret: credential.secret };
}

describe.skipIf(!live)("snap-app link, earn and redeem (8.4.b), live", () => {
  it.each([
    ["AU" as const, "AUD" as const],
    ["ID" as const, "IDR" as const],
  ])(
    "%s: links, earns through the real partner action, buys and redeems at a real counter",
    async (region, currency) => {
      const devices = new DrizzleCounterDeviceRepository(owner);

      // 1. A real consumer session (5.4.c link code needs one).
      const session = await sessionFor(app, { jurisdiction: region, dateOfBirth: "1990-01-01" });

      // 2. The listing this consumer will buy, and its business (for pairing a counter later).
      const { listingId, merchantId } = await listing(region);
      const { businessId, locationId } = await seedBusinessAndLocation(merchantId, region);

      // 3. 5.4.c: a one-time link code.
      const codeResponse = await app.inject({
        method: "POST",
        url: "/api/me/linked-apps/code",
        headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
      });
      expect(codeResponse.statusCode, codeResponse.body).toBe(201);
      const { code: linkCode } = codeResponse.json<{ code: string }>();

      // 4. 8.4.a: snap-app scans a receipt, signed with the seeded partner secret.
      const { partnerId, secret: partnerSecret } = await seedPartner();
      const rawBody = JSON.stringify({
        user: linkCode,
        action: "receipt_scanned",
        externalRef: `receipt-${randomUUID()}`,
        evidence: { ocr: `${currency} coffee` },
      });
      const earned = await app.inject({
        method: "POST",
        url: "/api/partners/actions",
        headers: signedPartnerHeaders(partnerId, partnerSecret, rawBody),
        payload: rawBody,
      });
      expect(earned.statusCode, earned.body).toBe(200);
      const grant = earned.json<{ granted: boolean; points: number }>();
      expect(grant.granted).toBe(true);
      expect(grant.points).toBeGreaterThan(0);

      // 5. 4.7: buy the listing with the points that receipt scan just granted.
      const quoted = await app.inject({
        method: "POST",
        url: "/api/checkout/quote",
        headers: { cookie: session.cookie },
        payload: { listingId },
      });
      expect(quoted.statusCode, quoted.body).toBe(201);
      const quote = checkoutQuoteSchema.parse(quoted.json());
      expect(quote.pricePoints).toBeLessThanOrEqual(grant.points);

      const confirmed = await app.inject({
        method: "POST",
        url: "/api/checkout",
        headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
        payload: { checkoutId: quote.checkoutId },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const result = checkoutResultSchema.parse(confirmed.json());
      expect(result.state).toBe("done");
      const voucherId = result.voucherId;

      // 6. Redeem at a real, paired counter device (8.2.h is merged; the
      // documented device path, per this Check's own instruction).
      const revealed = await deps.vouchers.reveal({ voucherId, ownerId: session.userId });
      const { code } = revealed._unsafeUnwrap();

      const { secret: deviceSecret } = await provisionAndPairDevice(
        devices,
        businessId,
        locationId,
        region,
      );
      const deviceHeaders = { authorization: `Bearer ${deviceSecret}` };

      const authorized = await app.inject({
        method: "POST",
        url: "/api/counter/authorize",
        headers: { ...deviceHeaders, "idempotency-key": randomUUID() },
        payload: {
          code,
          currency,
          orderRef: `8-4-b-${randomUUID()}`,
          orderTotalMinor: toMinorUnits(region === "AU" ? 60 : 1_200),
        },
      });
      expect(authorized.statusCode, authorized.body).toBe(201);
      const authorization = authorized.json<{ authorizationId: string; voucherId: string }>();
      expect(authorization.voucherId).toBe(voucherId);

      const captured = await app.inject({
        method: "POST",
        url: "/api/counter/capture",
        headers: { ...deviceHeaders, "idempotency-key": randomUUID() },
        payload: { authorizationId: authorization.authorizationId },
      });
      expect(captured.statusCode, captured.body).toBe(201);
      const capture = captured.json<{ captureId: string; voucherId: string }>();
      expect(capture.voucherId).toBe(voucherId);

      // The whole loop closed: bought through checkout, captured at the
      // counter. `deps.vouchers.get()` reports the RESERVATION saga's own
      // terminal state ("activated", voucher-internal/lifecycle.ts) which
      // never changes after a capture — the voucher's own lifecycle state
      // (voucher.vouchers.state) is the one that actually moves to
      // "redeemed", so that is what proves the capture really landed.
      const voucherRow = await owner.execute<{ state: string }>(sql`
      SELECT state FROM voucher.vouchers WHERE id = ${voucherId}`);
      expect(voucherRow.rows[0]?.state).toBe("redeemed");
    },
  );
});
