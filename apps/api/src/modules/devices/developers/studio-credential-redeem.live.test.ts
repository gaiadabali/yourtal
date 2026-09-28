import { createHash, createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { sql } from "drizzle-orm";
import { AppModule } from "../../../app.module";
import { createAppDb, type AppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { SAGA_DEPS } from "../../checkout/checkout.tokens";
import type { SagaDeps } from "../../checkout/use-cases/run-saga";
import { businessAccounts } from "../../business/persistence/schema/business-account.table";
import { businessMembers } from "../../business/persistence/schema/business-member.table";
import { startLiveServices, type LiveServices } from "../testing/live-services";

/**
 * TASKS.md 8.3.f, over real HTTP with no DB hacks: a credential issued
 * through the real Studio -> Developers route (`POST /api/:tenantId/studio/
 * developers/credentials`) is merchant-wide and can void and refund a real
 * AUD and a real IDR voucher, each refund producing exactly one signed
 * webhook delivery row — the exact thing that was broken before this fix
 * (every Studio-issued credential was device-scoped and got
 * device_principal_refused on both). Also proves the explicit,
 * opt-in device-scoped credential still gets refused, and that a counter
 * device still cannot void or refund.
 *
 * Self-contained: builds and spawns its own ledger and voucher binaries via
 * `../testing/live-services.ts` (shared with
 * `partner-checkout-redeem.live.test.ts`), gated behind the same
 * CHECKOUT_LIVE=1 flag apps/api/vitest.config.ts already reads.
 *
 * Merchant HMAC signing is a small, disclosed duplicate of
 * `services/voucher/internal/merchantauth/signing.go`'s `Sign` — the same
 * "port it directly" reference the SDK's own README points integrators at,
 * not a shortcut around it. This is what the fix's own bug looked like in
 * the first place: the credential secret Studio issues is 64 hex
 * characters, and it must be decoded to the 32 raw bytes before signing
 * with it (packages/sdk-merchant/examples/authorize-and-capture.ts, 8.3.d).
 *
 * Run it:
 *   node packages/db/scripts/with-test-db.mjs -- \
 *     env CHECKOUT_LIVE=1 pnpm --filter @yourtal/api exec vitest run \
 *     src/modules/devices/developers/studio-credential-redeem.live.test.ts
 */
const live = process.env["CHECKOUT_LIVE"] === "1";

let app: NestFastifyApplication;
let deps: SagaDeps;
let owner: AppDb;
let liveServices: LiveServices | undefined;

beforeAll(async () => {
  if (!live) return;
  const root = path.resolve(process.cwd(), "..", "..");
  liveServices = await startLiveServices(root, { withWorker: true });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  deps = app.get(SAGA_DEPS);
  owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
}, 120_000);

afterAll(async () => {
  if (!live) return;
  await app.close();
  await liveServices?.stop();
});

function merchantSign(
  secret: Buffer,
  keyId: string,
  method: string,
  pathAndQuery: string,
  idempotencyKey: string,
  body: string,
  at: Date,
): string {
  const unixSeconds = Math.floor(at.getTime() / 1000);
  const digest = createHash("sha256").update(body).digest("base64");
  const canonical = [unixSeconds, keyId, method.toUpperCase(), pathAndQuery, idempotencyKey, digest].join(
    "\n",
  );
  const mac = createHmac("sha256", secret).update(canonical).digest("hex");
  return `t=${String(unixSeconds)},k=${keyId},v1=${mac}`;
}

/**
 * services/voucher/internal/serviceauth's canonical string (apps/api's own
 * `HttpVoucherClient` mirrors this exactly) — used ONLY to reach the
 * explicit device-scoped credential option `/internal/v1/credentials`
 * still offers, the same way apps/api itself would. Never used to call a
 * merchant-facing route.
 */
function serviceSign(secret: string, caller: string, method: string, pathAndQuery: string, body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const digest = createHash("sha256").update(body).digest("base64");
  const mac = createHmac("sha256", secret)
    .update([String(t), caller, nonce, method, pathAndQuery, digest].join("\n"))
    .digest("hex");
  return `t=${String(t)},c=${caller},n=${nonce},v1=${mac}`;
}

async function callVoucherService(
  voucherUrl: string,
  keyId: string,
  secretHex: string,
  path_: string,
  body: Record<string, unknown>,
  idempotencyKey = randomUUID(),
): Promise<{ status: number; json: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  const secret = Buffer.from(secretHex, "hex");
  const signature = merchantSign(secret, keyId, "POST", path_, idempotencyKey, payload, new Date());
  const res = await fetch(`${voucherUrl}${path_}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yourtal-signature": signature,
      "idempotency-key": idempotencyKey,
    },
    body: payload,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: res.status, json };
}

/** Narrows a decoded JSON field to a string for the small set of fields these tests read back. */
function str(json: Record<string, unknown>, key: string): string {
  const value = json[key];
  if (typeof value !== "string") throw new Error(`expected ${key} to be a string, got ${JSON.stringify(value)}`);
  return value;
}

async function seedBusiness(region: "AU" | "ID"): Promise<string> {
  const businessId = randomUUID();
  await owner.insert(businessAccounts).values({
    id: businessId,
    legalName: "8.3.f Test Business",
    displayName: "8.3.f Test Business",
    taxIdKind: region === "AU" ? "ABN" : "NPWP",
    taxIdValue: "12345678901",
    addressState: region === "AU" ? "NSW" : null,
    addressPostcode: region === "AU" ? "2000" : null,
    addressCity: region === "AU" ? null : "Jakarta",
    roles: ["redeemer"],
    region,
    currency: region === "AU" ? "AUD" : "IDR",
    handle: `biz-8-3-f-${randomUUID().slice(0, 8)}`,
  });
  return businessId;
}

/** A business plus a real, logged-in owner session — `view_credential` needs a real `business_members` row, not just a session. */
async function seedBusinessWithOwner(
  region: "AU" | "ID",
): Promise<{ businessId: string; session: Awaited<ReturnType<typeof sessionFor>> }> {
  const businessId = await seedBusiness(region);
  const session = await sessionFor(app, { jurisdiction: region, dateOfBirth: "1980-01-01" });
  await owner.insert(businessMembers).values({
    businessId,
    userId: session.userId,
    role: "owner",
    invitedByUserId: session.userId,
    joinedAt: new Date(),
  });
  return { businessId, session };
}

/** A real, owned, spendable voucher — minted, reserved and activated through the real production Go path. */
async function mintOwnedVoucher(
  merchantId: string,
  region: "AU" | "ID",
  faceValueMinor: number,
): Promise<{ voucherId: string; code: string }> {
  const currency = region === "AU" ? "AUD" : "IDR";
  const listingId = randomUUID();
  const locationId = randomUUID();
  await owner.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points,
       stock_remaining, stock_total, transferable, partial_redemption_policy,
       minimum_spend_minor, expires_at, status, lifecycle_state, currency, region, audience,
       content_category, image_url, channel, partial_redemption)
    VALUES (${listingId}, ${merchantId}, '8.3.f Test Merchant', '8.3.f Test Listing',
            'seeded for studio-credential-redeem.live.test.ts', 'food-and-drink',
            ${faceValueMinor}, ${Math.floor(faceValueMinor / 2)}, 1, 1, 1, false, 'balance_carrying',
            NULL, now() + interval '90 days', 'available', 'active', ${currency}, ${region},
            'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg',
            'in_store', 'single_use')`);
  await owner.execute(sql`
    INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
    VALUES (${locationId}, ${merchantId}, '8.3.f Test Branch', '1 Test St', 'Test District')`);
  await owner.execute(sql`
    INSERT INTO store.listing_location (listing_id, location_id) VALUES (${listingId}, ${locationId})`);

  const batch = (
    await deps.vouchers.requestBatch({
      listingId,
      merchantId,
      currency,
      faceValueMinor: toMinorUnits(faceValueMinor),
      quantity: 1,
      partialRedemptionPolicy: "balance_carrying",
      requestedBy: "staff-1",
    })
  )._unsafeUnwrap();
  (await deps.vouchers.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" }))._unsafeUnwrap();

  const sagaId = randomUUID();
  const reserved = (await deps.vouchers.reserve({ listingId, sagaId }))._unsafeUnwrap();
  const ownerId = randomUUID();
  (await deps.vouchers.activate({ sagaId, ownerId }))._unsafeUnwrap();
  const revealed = (
    await deps.vouchers.reveal({ voucherId: reserved.voucherId, ownerId })
  )._unsafeUnwrap();
  return { voucherId: reserved.voucherId, code: revealed.code };
}

/** webhook-outbox-drain.ts runs on a "* * * * *" schedule — give it up to 75s. */
async function waitForDeliveredRow(idempotencyKey: string, category: string): Promise<number> {
  for (let attempt = 0; attempt < 75; attempt++) {
    const result = await owner.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM platform.sim_outbox
       WHERE boundary = 'webhook' AND idempotency_key = ${idempotencyKey} AND category = ${category}`);
    const count = Number(result.rows[0]?.count ?? "0");
    if (count > 0) return count;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return 0;
}

describe.skipIf(!live)("Studio-issued merchant credentials are merchant-wide (8.3.f), live", () => {
  it.each([
    ["AU" as const, "AUD" as const, 2_000],
    ["ID" as const, "IDR" as const, 20_000],
  ])(
    "%s: a credential issued through the Studio route can void and refund a real voucher",
    async (region, currency, faceValueMinor) => {
      const { businessId, session } = await seedBusinessWithOwner(region);

      // 1. Issue through the REAL Studio route.
      const issued = await app.inject({
        method: "POST",
        url: `/api/${businessId}/studio/developers/credentials`,
        headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
        payload: { label: `8.3.f ${region} credential`, sandbox: true },
      });
      expect(issued.statusCode, issued.body).toBe(201);
      const credential = issued.json<{ credentialId: string; secret: string; deviceId?: string }>();
      expect(credential.deviceId).toBeUndefined();

      // A webhook has to be registered for a delivery to exist at all
      // (webhook-delivery.ts's own "no subscription, nothing to deliver"
      // no-op) — through the real Studio route too.
      const webhookRegistered = await app.inject({
        method: "POST",
        url: `/api/${businessId}/studio/developers/webhooks`,
        headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
        payload: { url: `https://example.test/webhooks/8-3-f-${region.toLowerCase()}-${String(Date.now())}` },
      });
      expect(webhookRegistered.statusCode, webhookRegistered.body).toBe(201);

      const services = liveServices;
      if (services === undefined) throw new Error("live services were not started");

      // 2. Void one voucher.
      const { code: voidCode } = await mintOwnedVoucher(businessId, region, faceValueMinor);
      const authorizedForVoid = await callVoucherService(
        services.voucherUrl,
        credential.credentialId,
        credential.secret,
        "/v1/vouchers/authorize",
        { code: voidCode, amount: faceValueMinor, currency, merchant_order_ref: `8-3-f-void-${randomUUID()}` },
      );
      expect(authorizedForVoid.status, JSON.stringify(authorizedForVoid.json)).toBe(200);
      const voided = await callVoucherService(
        services.voucherUrl,
        credential.credentialId,
        credential.secret,
        "/v1/vouchers/void",
        { authorization_id: str(authorizedForVoid.json, "authorization_id") },
      );
      expect(voided.status, JSON.stringify(voided.json)).toBe(200);

      // 3. Capture then refund a SECOND voucher, and prove exactly one
      // signed voucher.refunded delivery. Half the face value: the
      // balance_carrying listing (mintOwnedVoucher) leaves the voucher
      // active with a remaining balance after a partial capture, so the
      // refund below has real value to restore instead of hitting
      // ErrRefundNeedsReplacement (YT-0142) on an already-fully-redeemed
      // voucher.
      const captureAmount = Math.floor(faceValueMinor / 2);
      const { voucherId, code } = await mintOwnedVoucher(businessId, region, faceValueMinor);
      const authorized = await callVoucherService(
        services.voucherUrl,
        credential.credentialId,
        credential.secret,
        "/v1/vouchers/authorize",
        { code, amount: captureAmount, currency, merchant_order_ref: `8-3-f-capture-${randomUUID()}` },
      );
      expect(authorized.status, JSON.stringify(authorized.json)).toBe(200);
      const captured = await callVoucherService(
        services.voucherUrl,
        credential.credentialId,
        credential.secret,
        "/v1/vouchers/capture",
        { authorization_id: str(authorized.json, "authorization_id"), final_amount: captureAmount },
      );
      expect(captured.status, JSON.stringify(captured.json)).toBe(200);
      const receiptId = str(captured.json, "receipt_id");
      expect(receiptId).toBeTruthy();

      const refundRef = `8-3-f-refund-${randomUUID()}`;
      const refunded = await callVoucherService(
        services.voucherUrl,
        credential.credentialId,
        credential.secret,
        "/v1/vouchers/refund",
        {
          receipt_id: receiptId,
          amount: Math.floor(captureAmount / 2),
          reason: "8.3.f e2e refund",
          refund_ref: refundRef,
        },
      );
      expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);

      const captureRow = await owner.execute<{ id: string }>(sql`
        SELECT id::text FROM voucher.capture WHERE receipt_id = ${receiptId}`);
      const captureId = captureRow.rows[0]?.id;
      expect(captureId).toBeTruthy();
      if (captureId === undefined) throw new Error("no capture row was found");

      expect(await waitForDeliveredRow(captureId, "voucher.captured")).toBe(1);
      const refundRows = await owner.execute<{ id: string }>(sql`
        SELECT id::text FROM platform.sim_outbox
         WHERE boundary = 'webhook' AND category = 'voucher.refunded'
           AND metadata->'data'->>'captureId' = ${captureId}`);
      expect(refundRows.rows).toHaveLength(1);
      expect(voucherId).toBeTruthy();
    },
    60_000,
  );

  it("a device-scoped credential (the explicit, opt-in kind) still gets device_principal_refused over real HTTP", async () => {
    const services = liveServices;
    if (services === undefined) throw new Error("live services were not started");
    const businessId = await seedBusiness("AU");

    // No caller mints a device-scoped credential today (Studio never sends
    // deviceId — that is this whole fix). Issue one the way the ONE caller
    // who could ever legitimately want one would: a real, serviceauth-
    // signed call to /internal/v1/credentials with an explicit deviceId —
    // the same route and signing scheme apps/api's own HttpVoucherClient
    // uses, not a DB write (the real credential row, properly sealed with
    // the running service's own keyring, so its signature genuinely
    // verifies — a DB insert could not produce that).
    const issuePath = "/internal/v1/credentials";
    const issueBody = JSON.stringify({ merchantId: businessId, deviceId: "8.3.f-terminal-1", issuedBy: "test" });
    const issueSignature = serviceSign(
      services.voucherSecret,
      "worker",
      "POST",
      issuePath,
      issueBody,
    );
    const issueResponse = await fetch(`${services.voucherUrl}${issuePath}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-yourtal-service-signature": issueSignature },
      body: issueBody,
    });
    expect(issueResponse.status).toBe(200);
    const deviceCredential = (await issueResponse.json()) as {
      credentialId: string;
      secret: string;
      deviceId?: string;
    };
    expect(deviceCredential.deviceId).toBe("8.3.f-terminal-1");

    const refused = await callVoucherService(
      services.voucherUrl,
      deviceCredential.credentialId,
      deviceCredential.secret,
      "/v1/vouchers/refund",
      { receipt_id: "rcpt_does-not-matter", amount: 1, reason: "x", refund_ref: randomUUID() },
    );
    expect(refused.status, JSON.stringify(refused.json)).toBe(403);
    const errorBody = refused.json["error"];
    expect(
      typeof errorBody === "object" && errorBody !== null ? (errorBody as Record<string, unknown>)["code"] : undefined,
    ).toBe("device_principal_refused");
  });

  it("a counter device still cannot void or refund (8.2.c)", async () => {
    // Structural, over real HTTP: apps/api's counter BFF exposes no
    // void/refund route at all (counter.controller.ts has lookup/authorize/
    // capture/log only), and a counter device never signs a merchantauth
    // request in the first place (confirmed while investigating 8.3.f: the
    // counter exclusively calls /internal/v1/device/* over serviceauth).
    // The Cerbos-level DENY for store_device on void/refund is
    // device-authentication.e2e.test.ts's own coverage (8.1.c) --
    // cited, not duplicated, here.
    for (const url of ["/api/counter/void", "/api/counter/refund"]) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      expect(response.statusCode, `${url} should not exist`).toBe(404);
    }
  });
});
