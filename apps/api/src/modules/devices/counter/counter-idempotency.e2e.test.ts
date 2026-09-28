import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { hash as argon2Hash } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { businessAccounts } from "../../business/persistence/schema/business-account.table";
import { merchantLocations } from "../../store/persistence/schema/listing.table";
import { DrizzleCounterDeviceRepository } from "../persistence/drizzle-counter-device.repository";
import { issueDeviceCredential, issuePairingCode } from "../crypto/device-token";

/**
 * TASKS.md 8.2.h (F70): the real HTTP-round-trip Check the founder's report
 * asked for -- a paired device authorizes then captures a REAL (fake-mode)
 * voucher, a replay of the identical call returns the SAME result instead
 * of a second one, and a revoked device still gets 401. Before this
 * session's fix, authorize/capture 401'd on EVERY call from a correctly
 * paired device (`IdempotencyInterceptor.scopeFor` fell through to the
 * session resolver, which has no session to find) -- this suite is what
 * would have caught it.
 */
let app: NestFastifyApplication;
const db: AppDb = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const devices = new DrizzleCounterDeviceRepository(db);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // rawBody, same reason partner-actions.e2e.test.ts needs it: not exercised
  // by this suite directly, but main.ts's own NestApplicationOptions is what
  // every real boot uses, and nothing here should depend on the difference.
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function seedBusinessAndLocation(): Promise<{ businessId: string; locationId: string }> {
  const businessId = randomUUID();
  await db.insert(businessAccounts).values({
    id: businessId,
    legalName: "8.2.h Test Business Pty Ltd",
    displayName: "8.2.h Test Business",
    taxIdKind: "ABN",
    taxIdValue: "12345678901",
    addressState: "NSW",
    addressPostcode: "2000",
    addressCity: null,
    roles: ["redeemer"],
    region: "AU",
    currency: "AUD",
    handle: `biz-8-2-h-${randomUUID().slice(0, 8)}`,
  });
  const locationId = randomUUID();
  await db.insert(merchantLocations).values({
    id: locationId,
    merchantId: businessId,
    name: "8.2.h Test Store",
    address: "1 Test St",
    district: "Sydney",
  });
  return { businessId, locationId };
}

async function provisionAndPairDevice(
  businessId: string,
  locationId: string,
): Promise<{ deviceId: string; secret: string }> {
  const pinHash = await argon2Hash("1234");
  const pairing = issuePairingCode();
  const device = await devices.create({
    businessId,
    region: "AU",
    locationId,
    label: "Front counter",
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

/** A real `store.listings` row plus a matching `platform.voucher_fake_voucher`, code known to the test. */
async function seedRedeemableVoucher(
  merchantId: string,
): Promise<{ listingId: string; code: string }> {
  const listingId = randomUUID();
  const farFuture = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  await db.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points,
       stock_remaining, stock_total, transferable, partial_redemption_policy,
       minimum_spend_minor, expires_at, status, currency, region, audience,
       content_category, image_url, channel, partial_redemption)
    VALUES (${listingId}, ${merchantId}, '8.2.h Test Merchant', '8.2.h Test Listing',
            'seeded for counter-idempotency.e2e.test.ts', 'food-and-drink',
            50000, 15000, 1000, 10, 10, false, 'single_use_forfeit',
            NULL, ${farFuture}, 'available', 'AUD', 'AU', 'all_ages',
            'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')
  `);

  const voucherId = randomUUID();
  const code = randomUUID().replace(/-/g, "").toUpperCase().slice(0, 16);
  const codeHash = createHash("sha256").update(code).digest("hex");
  await db.execute(sql`
    INSERT INTO platform.voucher_fake_voucher (id, listing_id, saga_id, code, code_hash)
    VALUES (${voucherId}, ${listingId}, ${randomUUID()}, ${code}, ${codeHash})
  `);
  return { listingId, code };
}

describe("counter authorize/capture over real HTTP, real device credential (8.2.h/F70)", () => {
  it("authorizes then captures a real voucher; a replay returns the same result", async () => {
    const { businessId, locationId } = await seedBusinessAndLocation();
    const { secret } = await provisionAndPairDevice(businessId, locationId);
    const { code } = await seedRedeemableVoucher(businessId);
    const headers = { authorization: `Bearer ${secret}` };

    const authorizeKey = randomUUID();
    const authorizeBody = {
      code,
      currency: "AUD",
      orderRef: `order-${randomUUID()}`,
      orderTotalMinor: 5000,
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/counter/authorize",
      headers: { ...headers, "idempotency-key": authorizeKey },
      payload: authorizeBody,
    });
    expect(first.statusCode, first.body).toBe(201);
    const authorized = first.json<{ authorizationId: string; voucherId: string }>();
    expect(authorized.authorizationId).toBeTruthy();

    // The bug this Check exists for: before the fix, THIS call 401'd —
    // IdempotencyInterceptor.scopeFor fell through to the session resolver,
    // which has no yt_session to find for a device-only request.
    const replay = await app.inject({
      method: "POST",
      url: "/api/counter/authorize",
      headers: { ...headers, "idempotency-key": authorizeKey },
      payload: authorizeBody,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json<{ authorizationId: string }>().authorizationId).toBe(
      authorized.authorizationId,
    );

    const captureKey = randomUUID();
    const captureBody = { authorizationId: authorized.authorizationId };

    const captured = await app.inject({
      method: "POST",
      url: "/api/counter/capture",
      headers: { ...headers, "idempotency-key": captureKey },
      payload: captureBody,
    });
    expect(captured.statusCode, captured.body).toBe(201);
    const capture = captured.json<{ captureId: string; voucherId: string }>();
    expect(capture.voucherId).toBe(authorized.voucherId);

    const captureReplay = await app.inject({
      method: "POST",
      url: "/api/counter/capture",
      headers: { ...headers, "idempotency-key": captureKey },
      payload: captureBody,
    });
    expect(captureReplay.statusCode, captureReplay.body).toBe(201);
    expect(captureReplay.json<{ captureId: string }>().captureId).toBe(capture.captureId);
  });

  it("a revoked device still gets 401, not a replay of its own earlier authorize", async () => {
    const { businessId, locationId } = await seedBusinessAndLocation();
    const { deviceId, secret } = await provisionAndPairDevice(businessId, locationId);
    const { code } = await seedRedeemableVoucher(businessId);

    const revoked = await devices.revoke(deviceId, businessId, "test-owner");
    expect(revoked).not.toBeNull();

    const response = await app.inject({
      method: "POST",
      url: "/api/counter/authorize",
      headers: { authorization: `Bearer ${secret}`, "idempotency-key": randomUUID() },
      payload: { code, currency: "AUD", orderRef: `order-${randomUUID()}`, orderTotalMinor: 5000 },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe("invalid_device_credential");
  });
});
