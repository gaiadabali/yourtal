import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { AppModule } from "../../../app.module";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { sessionFor, type TestSession } from "../../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * 2.8.g over the real HTTP stack (real Postgres and Cerbos, fake ledger): a
 * listing's staff-set points price is finance-only and two-person, and once
 * approved the store read and the checkout quote both charge max(it, the
 * ledger's quote) -- never below the quote.
 */
let app: NestFastifyApplication;
let owner: Pool;
let ledgerPrice: number;
const SETTLEMENT = 500;
const LISTING = randomUUID();
const MERCHANT = randomUUID();
const LOCATION = randomUUID();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
  // The cached price a listing is created with, as priceListing writes it; the
  // fake ledger keeps no listing price, so reads fall back to it.
  const ledger: LedgerInternalClient = app.get(LEDGER_INTERNAL_CLIENT, { strict: false });
  ledgerPrice = (
    await ledger.quote({ region: "AU", currency: "AUD", settlementMinor: toMinorUnits(SETTLEMENT) })
  )._unsafeUnwrap().pricePoints;
  await owner.query(
    `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
       currency, face_value_minor, settlement_value_minor, price_in_points, stock_remaining,
       stock_total, transferable, partial_redemption_policy, minimum_spend_minor, expires_at,
       status, region, audience, content_category, image_url, channel, partial_redemption,
       lifecycle_state)
     VALUES ($1, $2, 'Price probe merchant', $3, 'Probe', 'food_beverage', 'AUD', $4, $4, $5, 5, 5,
       false, 'single_use_forfeit', NULL, now() + interval '30 days', 'available', 'AU',
       'all_ages', 'food-and-drink', 'https://cdn.example.com/probe.jpg', 'in_store',
       'single_use', 'active')`,
    [LISTING, MERCHANT, `Price probe ${LISTING.slice(0, 8)}`, SETTLEMENT, ledgerPrice],
  );
  // A listing offers at least one branch (listingSchema's .min(1)).
  await owner.query(
    `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
     VALUES ($1, $2, 'Probe branch', '1 Probe St', 'Probe')`,
    [LOCATION, MERCHANT],
  );
  await owner.query(
    `INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`,
    [LISTING, LOCATION],
  );
});

afterAll(async () => {
  await owner.query(`DELETE FROM staff.economy_proposal WHERE payload->>'listingId' = $1`, [
    LISTING,
  ]);
  await owner.query(`DELETE FROM store.listing_location WHERE listing_id = $1`, [LISTING]);
  await owner.query(`DELETE FROM store.listings WHERE id = $1`, [LISTING]);
  await owner.query(`DELETE FROM store.merchant_location WHERE id = $1`, [LOCATION]);
  await owner.end();
  await app.close();
});

async function staff(role: "finance" | "ops" | "support"): Promise<TestSession> {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

function screen(session: TestSession, query = LISTING) {
  return app.inject({
    method: "GET",
    url: `/api/staff/economy/AU/listing-prices?q=${encodeURIComponent(query)}`,
    headers: { cookie: session.cookie },
  });
}

function propose(session: TestSession, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/staff/economy/AU/listing-prices/proposals",
    headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    payload: { listingId: LISTING, reason: "2.8.g check", ...payload },
  });
}

function decide(session: TestSession, id: string, decision: "approve" | "reject") {
  return app.inject({
    method: "POST",
    url: `/api/staff/economy/AU/listing-prices/proposals/${id}/${decision}`,
    headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    payload: {},
  });
}

/** Proposes as one finance person and approves as another. */
async function setPrice(minPricePoints: number | null): Promise<void> {
  const [a, b] = [await staff("finance"), await staff("finance")];
  const proposed = await propose(a, { minPricePoints });
  expect(proposed.statusCode).toBe(201);
  expect((await decide(b, proposed.json<{ id: string }>().id, "approve")).statusCode).toBe(201);
}

async function storedPrice(): Promise<number | null> {
  const { rows } = await owner.query<{ min_price_points: string | null }>(
    `SELECT min_price_points FROM store.listings WHERE id = $1`,
    [LISTING],
  );
  const value = rows[0]?.min_price_points ?? null;
  return value === null ? null : Number(value);
}

async function buyerSees(): Promise<{ listed: number; quoted: number }> {
  const buyer = await sessionFor(app, { jurisdiction: "AU", dateOfBirth: "1990-01-01" });
  const listed = await app.inject({
    method: "GET",
    url: `/api/store/listings/${LISTING}`,
    headers: { cookie: buyer.cookie },
  });
  const quoted = await app.inject({
    method: "POST",
    url: "/api/checkout/quote",
    headers: { cookie: buyer.cookie, "idempotency-key": randomUUID() },
    payload: { listingId: LISTING },
  });
  expect(listed.statusCode).toBe(200);
  expect(quoted.statusCode).toBe(201);
  return {
    listed: listed.json<{ priceInPoints: number }>().priceInPoints,
    quoted: quoted.json<{ pricePoints: number }>().pricePoints,
  };
}

describe("who may see and set a listing's points price", () => {
  it("is finance only: a consumer, support and ops are refused", async () => {
    const consumer = await sessionFor(app, { jurisdiction: "AU" });
    for (const session of [consumer, await staff("support"), await staff("ops")]) {
      expect((await screen(session)).statusCode).toBe(403);
      expect((await propose(session, { minPricePoints: 200 })).statusCode).toBe(403);
    }
    expect(await storedPrice()).toBeNull();
  });

  it("shows the ledger quote, the staff price and what a buyer pays", async () => {
    const response = await screen(await staff("finance"));
    expect(response.statusCode).toBe(200);
    const row = response
      .json<{ rows: { listingId: string; ledgerPricePoints: number; minPricePoints: null }[] }>()
      .rows.find((candidate) => candidate.listingId === LISTING);
    expect(row).toMatchObject({
      ledgerPricePoints: ledgerPrice,
      minPricePoints: null,
      effectivePricePoints: ledgerPrice,
      pending: null,
    });
  });

  it("refuses a price that is not a positive whole number, an unknown listing, or no reason", async () => {
    const finance = await staff("finance");
    for (const minPricePoints of [0, -5, 1.5, "200"]) {
      expect((await propose(finance, { minPricePoints })).statusCode).toBe(400);
    }
    expect((await propose(finance, { minPricePoints: 200, reason: "" })).statusCode).toBe(400);
    const unknown = await propose(finance, { minPricePoints: 200, listingId: randomUUID() });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("two-person approval", () => {
  it("the proposer cannot approve their own price; a second finance person can, once", async () => {
    const [a, b] = [await staff("finance"), await staff("finance")];
    const proposed = await propose(a, { minPricePoints: ledgerPrice + 33 });
    expect(proposed.statusCode).toBe(201);
    const id = proposed.json<{ id: string; status: string }>().id;

    // One open proposal per listing.
    expect((await propose(b, { minPricePoints: ledgerPrice + 50 })).statusCode).toBe(409);
    expect((await decide(a, id, "approve")).statusCode).toBe(403);
    expect(await storedPrice()).toBeNull();

    const pendingRow = (await screen(b))
      .json<{ rows: { listingId: string; pending: { minPricePoints: number } | null }[] }>()
      .rows.find((row) => row.listingId === LISTING);
    expect(pendingRow?.pending?.minPricePoints).toBe(ledgerPrice + 33);

    const approved = await decide(b, id, "approve");
    expect(approved.statusCode).toBe(201);
    expect(approved.json<{ status: string }>().status).toBe("approved");
    expect(await storedPrice()).toBe(ledgerPrice + 33);
    expect((await decide(b, id, "approve")).statusCode).toBe(400);
  });

  it("a proposer may withdraw their own proposal, and nothing changes", async () => {
    const finance = await staff("finance");
    const proposed = await propose(finance, { minPricePoints: ledgerPrice + 99 });
    expect(proposed.statusCode).toBe(201);
    const rejected = await decide(finance, proposed.json<{ id: string }>().id, "reject");
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json<{ status: string }>().status).toBe("rejected");
    expect(await storedPrice()).toBe(ledgerPrice + 33);
  });
});

describe("what a buyer pays is max(staff price, ledger quote)", () => {
  it("above the quote: the listing reads and checkout quotes the staff price", async () => {
    await setPrice(ledgerPrice + 40);
    expect(await buyerSees()).toEqual({ listed: ledgerPrice + 40, quoted: ledgerPrice + 40 });
  });

  it("below the quote: the ledger's quote wins, so backing is always covered", async () => {
    await setPrice(1);
    expect(await storedPrice()).toBe(1);
    expect(await buyerSees()).toEqual({ listed: ledgerPrice, quoted: ledgerPrice });
  });

  it("cleared: the listing is back to the ledger's quote", async () => {
    await setPrice(null);
    expect(await storedPrice()).toBeNull();
    expect(await buyerSees()).toEqual({ listed: ledgerPrice, quoted: ledgerPrice });
  });
});
