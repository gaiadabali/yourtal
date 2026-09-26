import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openSync } from "node:fs";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutQuoteSchema, checkoutResultSchema } from "@yourtal/contracts/checkout/checkout";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../app.module";
import { createAppDb, type AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { SAGA_DEPS } from "./checkout.tokens";
import { recoverSagas } from "./use-cases/recover-sagas";
import type { SagaDeps } from "./use-cases/run-saga";

// 4.7.d against the live ledger and voucher services, which
// scripts/checkout-live.mjs builds and points this at. Skipped otherwise.
// This spec owns the voucher process, so it can kill it mid-saga.

const live = process.env["CHECKOUT_LIVE"] === "1";
const voucherUrl = process.env["VOUCHER_BASE_URL"] ?? "";

let app: NestFastifyApplication;
let deps: SagaDeps;
let owner: AppDb;
let voucher: ChildProcess | undefined;

async function healthy(): Promise<boolean> {
  return fetch(`${voucherUrl}/healthz`).then(
    (r) => r.ok,
    () => false,
  );
}

async function startVoucher(): Promise<void> {
  const log = openSync(process.env["CHECKOUT_LIVE_VOUCHER_LOG"] ?? "voucher.log", "a");
  voucher = spawn(process.env["CHECKOUT_LIVE_VOUCHER_BIN"] ?? "", [], {
    env: process.env,
    stdio: ["ignore", log, log],
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await healthy()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the voucher service never became ready");
}

/** A hard kill: no graceful shutdown, as a crash would be. */
async function killVoucher(): Promise<void> {
  const running = voucher;
  if (running === undefined) return;
  const exited = new Promise((r) => running.once("exit", r));
  running.kill("SIGKILL");
  await exited;
  voucher = undefined;
  expect(await healthy()).toBe(false);
}

beforeAll(async () => {
  if (!live) return;
  await startVoucher();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  deps = app.get(SAGA_DEPS);
  owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
  for (const region of ["ID", "AU"] as const) {
    const funded = await deps.ledger.fundMarketing({
      region,
      amountMinor: toMinorUnits(region === "ID" ? 50_000_000 : 500_000),
      proposedBy: "staff-1",
      approvedBy: "staff-2",
    });
    expect(funded.isOk()).toBe(true);
  }
});

afterAll(async () => {
  if (!live) return;
  await app.close();
  await killVoucher();
});

/**
 * A buyable listing in `region`: a store row with a branch, priced in the
 * ledger (the burn reads its S from there) and stocked by an approved batch.
 */
async function listing(region: "ID" | "AU"): Promise<string> {
  const listingId = randomUUID();
  const merchantId = randomUUID();
  const locationId = randomUUID();
  const currency = region === "ID" ? "IDR" : "AUD";
  const face = region === "ID" ? 50_000 : 2_000;
  const settlement = region === "ID" ? 15_000 : 600;
  await owner.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points,
       stock_remaining, stock_total, transferable, partial_redemption_policy,
       minimum_spend_minor, expires_at, status, lifecycle_state, currency, region, audience,
       content_category, image_url, channel, partial_redemption)
    VALUES (${listingId}, ${merchantId}, 'Live Saga Merchant', 'Live Saga Listing',
            'seeded for checkout.live.test.ts', 'food-and-drink',
            ${face}, ${settlement}, 1000, 5, 5, false, 'single_use_forfeit',
            NULL, now() + interval '90 days', 'available', 'active', ${currency}, ${region},
            'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg',
            'in_store', 'single_use')`);
  await owner.execute(sql`
    INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
    VALUES (${locationId}, ${merchantId}, 'Live Branch', '1 Test St', 'Test District')`);
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
      quantity: 5,
      partialRedemptionPolicy: "single_use_forfeit",
      requestedBy: "staff-1",
    })
  )._unsafeUnwrap();
  (
    await deps.vouchers.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" })
  )._unsafeUnwrap();
  return listingId;
}

async function earn(userId: string, region: "ID" | "AU", points: number): Promise<void> {
  const granted = await deps.ledger.grantAction({
    kind: "goodwill",
    userId,
    region,
    points: toPoints(points),
    trustTier: 3,
    idempotencyKey: randomUUID(),
  });
  expect(granted.isOk()).toBe(true);
}

async function post(url: string, headers: Record<string, string>, payload: object) {
  return app.inject({ method: "POST", url, headers, payload });
}

async function available(userId: string): Promise<number> {
  return (await deps.ledger.balance(userId))._unsafeUnwrap().availablePoints;
}

/** Rows the saga wrote: ledger burns and vouchers carrying this saga id. */
async function rows(sagaId: string): Promise<{ burns: number; vouchers: number; state: string }> {
  const counted = await owner.execute<{ burns: string; vouchers: string; state: string }>(sql`
    SELECT (SELECT count(*) FROM ledger.burn WHERE saga_id = ${sagaId}) AS burns,
           (SELECT count(*) FROM voucher.vouchers WHERE saga_id = ${sagaId}) AS vouchers,
           (SELECT state FROM checkout.saga WHERE id = ${sagaId}::uuid) AS state`);
  const row = counted.rows[0];
  return { burns: Number(row?.burns), vouchers: Number(row?.vouchers), state: row?.state ?? "" };
}

/** An ID account with `extra` points more than the quote it holds. */
async function quotedBuyer(extra: number) {
  const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
  const quoted = await post(
    "/api/checkout/quote",
    { cookie: session.cookie },
    { listingId: await listing("ID") },
  );
  expect(quoted.statusCode).toBe(201);
  const quote = checkoutQuoteSchema.parse(quoted.json());
  await earn(session.userId, "ID", quote.pricePoints + extra);
  return { session, quote };
}

describe.skipIf(!live)("checkout against the live ledger and voucher services", () => {
  it("a double submit burns once and issues one voucher", async () => {
    const { session, quote } = await quotedBuyer(7);
    const key = { cookie: session.cookie, "idempotency-key": randomUUID() };
    const first = await post("/api/checkout", key, { checkoutId: quote.checkoutId });
    expect(first.statusCode).toBe(200);
    const result = checkoutResultSchema.parse(first.json());
    expect(result).toMatchObject({ state: "done", pricePoints: quote.pricePoints });

    const replay = await post("/api/checkout", key, { checkoutId: quote.checkoutId });
    expect(replay.json()).toEqual(first.json());
    const fresh = await post(
      "/api/checkout",
      { cookie: session.cookie, "idempotency-key": randomUUID() },
      { checkoutId: quote.checkoutId },
    );
    expect(checkoutResultSchema.parse(fresh.json()).voucherId).toBe(result.voucherId);

    expect(await available(session.userId)).toBe(7);
    expect((await deps.ledger.getBurn(quote.checkoutId))._unsafeUnwrap()).toMatchObject({
      state: "burned",
      points: quote.pricePoints,
    });
    expect(await rows(quote.checkoutId)).toEqual({ burns: 1, vouchers: 1, state: "done" });
  });

  it("a voucher service down before the reserve spends nothing", async () => {
    const { session, quote } = await quotedBuyer(0);
    await killVoucher();
    try {
      const refused = await post(
        "/api/checkout",
        { cookie: session.cookie, "idempotency-key": randomUUID() },
        { checkoutId: quote.checkoutId },
      );
      expect(refused.statusCode).toBeGreaterThanOrEqual(500);
      expect(await rows(quote.checkoutId)).toEqual({ burns: 0, vouchers: 0, state: "quoted" });
      expect(await available(session.userId)).toBe(quote.pricePoints);
    } finally {
      await startVoucher();
    }
    const done = await post(
      "/api/checkout",
      { cookie: session.cookie, "idempotency-key": randomUUID() },
      { checkoutId: quote.checkoutId },
    );
    expect(checkoutResultSchema.parse(done.json()).state).toBe("done");
    expect(await available(session.userId)).toBe(0);
  });

  it("a voucher service killed between the burn and activate is whole after recovery", async () => {
    const { session, quote } = await quotedBuyer(3);
    // Reserve as the saga would, then take the voucher service down, so the
    // confirm burns and then cannot activate.
    const saga = await deps.sagas.findById(quote.checkoutId);
    if (saga === null) throw new Error("no saga");
    const reserved = (
      await deps.vouchers.reserve({ listingId: saga.listingId, sagaId: saga.id })
    )._unsafeUnwrap();
    await deps.sagas.advance(saga.id, "quoted", "reserved", {
      voucherId: reserved.voucherId,
      reservedUntil: new Date(Date.now() - 60_000),
    });
    await killVoucher();
    try {
      const pending = await post(
        "/api/checkout",
        { cookie: session.cookie, "idempotency-key": randomUUID() },
        { checkoutId: quote.checkoutId },
      );
      expect(pending.statusCode).toBe(200);
      expect(checkoutResultSchema.parse(pending.json())).toMatchObject({
        state: "pending",
        voucherId: reserved.voucherId,
      });
      expect(await rows(quote.checkoutId)).toEqual({ burns: 1, vouchers: 1, state: "burned" });
      // Recovery while it is still down leaves the saga for the next tick.
      expect((await recoverSagas(deps)).stillStuck).toBeGreaterThanOrEqual(1);
      expect((await deps.sagas.findById(saga.id))?.state).toBe("burned");
    } finally {
      await startVoucher();
    }
    await recoverSagas(deps);
    expect(await rows(quote.checkoutId)).toEqual({ burns: 1, vouchers: 1, state: "done" });
    expect(await available(session.userId)).toBe(3);
    expect(
      (
        await deps.vouchers.get({ voucherId: reserved.voucherId, ownerId: session.userId })
      )._unsafeUnwrap().state,
    ).toBe("activated");
  });

  it("an api crash after the burn, with the voucher service down, recovers from the ledger's record", async () => {
    const { session, quote } = await quotedBuyer(0);
    const saga = await deps.sagas.findById(quote.checkoutId);
    if (saga === null) throw new Error("no saga");
    const reserved = (
      await deps.vouchers.reserve({ listingId: saga.listingId, sagaId: saga.id })
    )._unsafeUnwrap();
    await deps.sagas.advance(saga.id, "quoted", "reserved", {
      voucherId: reserved.voucherId,
      reservedUntil: new Date(Date.now() - 60_000),
    });
    // The burn lands; the saga row never hears of it.
    const burned = await deps.ledger.burnForVoucher({
      userId: session.userId,
      listingId: saga.listingId,
      points: saga.pricePoints,
      sagaId: saga.id,
      quoteId: saga.quoteId,
    });
    expect(burned.isOk()).toBe(true);
    await killVoucher();
    try {
      await recoverSagas(deps);
      expect(await rows(saga.id)).toEqual({ burns: 1, vouchers: 1, state: "burned" });
    } finally {
      await startVoucher();
    }
    await recoverSagas(deps);
    expect(await rows(saga.id)).toEqual({ burns: 1, vouchers: 1, state: "done" });
    expect(await available(session.userId)).toBe(0);
  });

  it("an ID account cannot burn an AU listing, even calling the ledger directly", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    await earn(session.userId, "ID", 5_000);
    const auListing = await listing("AU");

    const quoted = await post(
      "/api/checkout/quote",
      { cookie: session.cookie },
      { listingId: auListing },
    );
    expect(quoted.statusCode).toBe(409);
    expect(quoted.json()).toMatchObject({ code: "region_mismatch" });

    // Past the api: no quote, then an AU quote the ledger itself locked.
    const sagaId = randomUUID();
    const direct = await deps.ledger.burnForVoucher({
      userId: session.userId,
      listingId: auListing,
      points: toPoints(200),
      sagaId,
    });
    expect(direct._unsafeUnwrapErr().code).toBe("region_mismatch");
    const auQuote = (
      await deps.ledger.quote({ region: "AU", currency: "AUD", settlementMinor: toMinorUnits(600) })
    )._unsafeUnwrap();
    const locked = (await deps.ledger.lockQuote({ quoteId: auQuote.quoteId }))._unsafeUnwrap();
    const withQuote = await deps.ledger.burnForVoucher({
      userId: session.userId,
      listingId: auListing,
      points: locked.pricePoints,
      sagaId,
      quoteId: locked.quoteId,
    });
    expect(withQuote._unsafeUnwrapErr().code).toBe("region_mismatch");
    expect(await rows(sagaId)).toMatchObject({ burns: 0 });
    expect(await available(session.userId)).toBe(5_000);
  });
});
