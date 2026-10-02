import { randomUUID } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { expect } from "vitest";
import { checkoutQuoteSchema, checkoutResultSchema } from "@yourtal/contracts/checkout/checkout";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { hash as argon2Hash } from "@node-rs/argon2";
import { AppModule } from "../app.module";
import { SAGA_DEPS } from "../modules/checkout/checkout.tokens";
import type { SagaDeps } from "../modules/checkout/use-cases/run-saga";
import { issueDeviceCredential, issuePairingCode } from "../modules/devices/crypto/device-token";
import { DrizzleCounterDeviceRepository } from "../modules/devices/persistence/drizzle-counter-device.repository";
import { startLiveServices, type LiveServices } from "../modules/devices/testing/live-services";
import { createAppDb, type AppDb } from "../shared/persistence/drizzle-client";
import { sessionFor, type TestSession } from "../shared/testing/session-for";

/**
 * 13.3.c: what A's journeys (9, 10, 13) share. Each journey runs the real api
 * against the live Go ledger and voucher services, in both regions, gated by
 * CHECKOUT_LIVE=1 like every other live suite. The owner connection only
 * seeds fixtures and reads ledger rows the app role cannot.
 */
export type Region = "AU" | "ID";
export const REGIONS: readonly Region[] = ["AU", "ID"];
export const live = process.env["CHECKOUT_LIVE"] === "1";

export interface Journey {
  readonly app: NestFastifyApplication;
  readonly deps: SagaDeps;
  readonly owner: AppDb;
  readonly services: LiveServices;
}

export async function startJourney(): Promise<Journey> {
  const services = await startLiveServices(path.resolve(process.cwd(), "..", ".."));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const deps = app.get<SagaDeps>(SAGA_DEPS);
  for (const region of REGIONS) {
    const funded = await deps.ledger.fundMarketing({
      region,
      amountMinor: toMinorUnits(region === "AU" ? 500_000 : 50_000_000),
      proposedBy: "staff-1",
      approvedBy: "staff-2",
    });
    expect(funded.isOk()).toBe(true);
  }
  return { app, deps, owner: createAppDb(process.env["DATABASE_OWNER_URL"] ?? ""), services };
}

export async function stopJourney(journey: Journey | undefined): Promise<void> {
  await journey?.app.close();
  await journey?.services.stop();
}

export function post(j: Journey, cookie: string, url: string, payload: unknown = {}) {
  return j.app.inject({
    method: "POST",
    url,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: payload as Record<string, unknown>,
  });
}

export async function staff(j: Journey, region: Region, role: string): Promise<TestSession> {
  const session = await sessionFor(j.app, { jurisdiction: region });
  await j.owner.execute(sql`
    INSERT INTO identity.staff_role (user_id, role, granted_by) VALUES (${session.userId}, ${role}, 'journey')`);
  return session;
}

export interface Shop {
  readonly listingId: string;
  readonly businessId: string;
  readonly locationId: string;
  readonly currency: "AUD" | "IDR";
  readonly settlementMinor: number;
}

/** A verified business with one location and a cheap, priced, stocked listing. */
export async function shop(j: Journey, region: Region): Promise<Shop> {
  const businessId = randomUUID();
  const listingId = randomUUID();
  const locationId = randomUUID();
  const currency = region === "AU" ? "AUD" : "IDR";
  const settlementMinor = region === "AU" ? 30 : 600;
  await j.owner.execute(sql`
    INSERT INTO business.business_accounts
      (id, legal_name, display_name, roles, is_verified, region, currency, handle,
       tax_id_kind, tax_id_value, address_state, address_postcode, address_city)
    VALUES (${businessId}, 'Journey Shop', 'Journey Shop', '["advertiser","redeemer"]'::jsonb, true,
            ${region}, ${currency}, ${`journey-${businessId.slice(0, 8)}`},
            ${region === "AU" ? "ABN" : "NPWP"}, '51824753556',
            ${region === "AU" ? "NSW" : null}, ${region === "AU" ? "2000" : null},
            ${region === "AU" ? null : "Jakarta"})`);
  await j.owner.execute(sql`
    INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
    VALUES (${locationId}, ${businessId}, 'Journey Branch', '1 Test St', 'Test District')`);
  await j.owner.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category, face_value_minor,
       settlement_value_minor, price_in_points, stock_remaining, stock_total, transferable,
       partial_redemption_policy, minimum_spend_minor, expires_at, status, lifecycle_state,
       currency, region, audience, content_category, image_url, channel, partial_redemption)
    VALUES (${listingId}, ${businessId}, 'Journey Shop', 'Journey voucher', 'journey fixture',
            'food_beverage', ${settlementMinor * 2}, ${settlementMinor}, 1, 3, 3, false,
            'single_use_forfeit', NULL, now() + interval '90 days', 'available', 'active',
            ${currency}, ${region}, 'all_ages', 'food-and-drink',
            'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'in_store', 'single_use')`);
  await j.owner.execute(sql`
    INSERT INTO store.listing_location (listing_id, location_id) VALUES (${listingId}, ${locationId})`);
  expect(
    (
      await j.deps.ledger.priceListing({
        listingId,
        region,
        currency,
        settlementMinor: toMinorUnits(settlementMinor),
      })
    ).isOk(),
  ).toBe(true);
  const batch = (
    await j.deps.vouchers.requestBatch({
      listingId,
      merchantId: businessId,
      currency,
      faceValueMinor: toMinorUnits(settlementMinor * 2),
      quantity: 3,
      partialRedemptionPolicy: "single_use_forfeit",
      requestedBy: "staff-1",
    })
  )._unsafeUnwrap();
  (
    await j.deps.vouchers.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" })
  )._unsafeUnwrap();
  return { listingId, businessId, locationId, currency, settlementMinor };
}

/** A viewer with spendable points: support credits goodwill and the hold ends. */
export async function fundedViewer(j: Journey, region: Region): Promise<TestSession> {
  const viewer = await sessionFor(j.app, { jurisdiction: region, dateOfBirth: "1990-01-01" });
  const support = await staff(j, region, "support");
  const credited = await post(j, support.cookie, `/api/staff/users/${viewer.userId}/goodwill`, {
    points: toPoints(region === "AU" ? 300 : 3_000),
    reason: "journey starting balance",
  });
  expect(credited.statusCode, credited.body).toBeLessThan(300);
  (
    await j.deps.ledger.advanceHoldback({ userId: viewer.userId, releaseNow: true })
  )._unsafeUnwrap();
  return viewer;
}

export async function available(j: Journey, viewer: TestSession): Promise<number> {
  const wallet = await j.app.inject({
    method: "GET",
    url: "/api/wallet",
    headers: { cookie: viewer.cookie },
  });
  expect(wallet.statusCode, wallet.body).toBe(200);
  return wallet.json<{ availablePoints: number }>().availablePoints;
}

/** Quote and buy; returns the voucher and what it cost. */
export async function buy(j: Journey, viewer: TestSession, listingId: string) {
  const quoted = await j.app.inject({
    method: "POST",
    url: "/api/checkout/quote",
    headers: { cookie: viewer.cookie },
    payload: { listingId },
  });
  expect(quoted.statusCode, quoted.body).toBe(201);
  const quote = checkoutQuoteSchema.parse(quoted.json());
  const done = await post(j, viewer.cookie, "/api/checkout", { checkoutId: quote.checkoutId });
  expect(done.statusCode, done.body).toBe(200);
  const result = checkoutResultSchema.parse(done.json());
  return { voucherId: result.voucherId, pricePoints: quote.pricePoints };
}

/** A paired, unlocked counter at the shop redeems the voucher in full. */
export async function redeemAtCounter(
  j: Journey,
  viewer: TestSession,
  s: Shop,
  region: Region,
  voucherId: string,
): Promise<void> {
  const devices = new DrizzleCounterDeviceRepository(j.owner);
  const pairing = issuePairingCode();
  const device = await devices.create({
    businessId: s.businessId,
    region,
    locationId: s.locationId,
    label: "Journey counter",
    pinHash: await argon2Hash("4242"),
    pairingCodeHash: pairing.hash,
    pairingExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    createdBy: "journey",
  });
  const credential = issueDeviceCredential();
  expect(await devices.pair(device.id, credential.hash, new Date())).not.toBeNull();
  const { code } = (
    await j.deps.vouchers.reveal({ voucherId, ownerId: viewer.userId })
  )._unsafeUnwrap();
  const headers = { authorization: `Bearer ${credential.secret}` };
  const authorized = await j.app.inject({
    method: "POST",
    url: "/api/counter/authorize",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {
      code,
      currency: s.currency,
      orderRef: `journey-${randomUUID()}`,
      orderTotalMinor: toMinorUnits(s.settlementMinor * 2),
    },
  });
  expect(authorized.statusCode, authorized.body).toBe(201);
  const captured = await j.app.inject({
    method: "POST",
    url: "/api/counter/capture",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { authorizationId: authorized.json<{ authorizationId: string }>().authorizationId },
  });
  expect(captured.statusCode, captured.body).toBe(201);
}

/** Waits for a condition the services reach on their own schedule (the voucher outbox, sweeps). */
export async function eventually(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`not reached within ${String(timeoutMs)} ms`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
