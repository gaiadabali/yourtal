import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutQuoteSchema, checkoutResultSchema } from "@yourtal/contracts/checkout/checkout";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { walletQrSchema } from "@yourtal/contracts/wallet/wallet";
import { AppModule } from "../../app.module";
import { createAppDb, type AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { SAGA_DEPS } from "./checkout.tokens";
import { recoverSagas } from "./use-cases/recover-sagas";
import type { SagaDeps } from "./use-cases/run-saga";

// 4.7 over real HTTP, a real PDP and the ledger/voucher clients the app is
// configured with (the fakes in CI; the live ledger re-checks in Go).

let app: NestFastifyApplication;
let deps: SagaDeps;
let owner: AppDb;

beforeAll(async () => {
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
  await app.close();
});

/** A seeded listing in `region`, made buyable for anyone (the test owns its database). */
async function buyableListing(region: "ID" | "AU", channel = "in_store"): Promise<string> {
  if (region === "AU") {
    // The seed is ID-only: copy one ID listing as an AU one. A listing with
    // vouchers can never move region (vouchers_in_their_listings_currency).
    await owner.execute(sql`
      INSERT INTO store.listings
      SELECT (jsonb_populate_record(NULL::store.listings, to_jsonb(l)
                || jsonb_build_object('id', gen_random_uuid(), 'region', 'AU', 'currency', 'AUD'))).*
        FROM store.listings l
       WHERE region = 'ID' AND NOT EXISTS (SELECT 1 FROM store.listings WHERE region = 'AU')
       LIMIT 1`);
  }
  const rows = await owner.execute<{ id: string }>(sql`
    UPDATE store.listings SET lifecycle_state = 'active', status = 'available', stock_remaining = stock_total,
           expires_at = now() + interval '30 days', audience = 'all_ages', channel = ${channel}
     WHERE id = (SELECT id FROM store.listings WHERE region = ${region} ORDER BY random() LIMIT 1)
    RETURNING id::text`);
  const id = rows.rows[0]?.id;
  if (id === undefined) throw new Error(`no seeded ${region} listing`);
  return id;
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

describe("POST /api/checkout", () => {
  it("spends the quoted points once and issues one voucher, however often it is confirmed", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const quoted = await post(
      "/api/checkout/quote",
      { cookie: session.cookie },
      {
        listingId: await buyableListing("ID"),
      },
    );
    expect(quoted.statusCode).toBe(201);
    const quote = checkoutQuoteSchema.parse(quoted.json());
    await earn(session.userId, "ID", quote.pricePoints + 5);

    const key = { cookie: session.cookie, "idempotency-key": randomUUID() };
    const first = await post("/api/checkout", key, { checkoutId: quote.checkoutId });
    expect(first.statusCode).toBe(200);
    const result = checkoutResultSchema.parse(first.json());
    expect(result).toMatchObject({ state: "done", pricePoints: quote.pricePoints });

    // A double submit, and a second confirm under a fresh key: one burn, one voucher.
    expect((await post("/api/checkout", key, { checkoutId: quote.checkoutId })).json()).toEqual(
      first.json(),
    );
    const again = await post(
      "/api/checkout",
      { cookie: session.cookie, "idempotency-key": randomUUID() },
      { checkoutId: quote.checkoutId },
    );
    expect(checkoutResultSchema.parse(again.json()).voucherId).toBe(result.voucherId);
    expect(await available(session.userId)).toBe(5);

    const wallet = await app.inject({
      method: "GET",
      url: "/api/wallet/vouchers",
      headers: { cookie: session.cookie },
    });
    expect(wallet.json()).toMatchObject({
      vouchers: [{ voucherId: result.voucherId, state: "activated" }],
    });

    // 4.8.b: the bought voucher shows a QR token in the wallet.
    const qr = await app.inject({
      method: "GET",
      url: `/api/wallet/vouchers/${result.voucherId}/qr`,
      headers: { cookie: session.cookie },
    });
    expect(qr.statusCode).toBe(200);
    expect(qr.json()).toMatchObject({
      voucherId: result.voucherId,
      token: expect.any(String) as unknown,
    });
    expect(new Date(walletQrSchema.parse(qr.json()).expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("refuses when the points are short, before reserving anything", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const quote = checkoutQuoteSchema.parse(
      (
        await post(
          "/api/checkout/quote",
          { cookie: session.cookie },
          {
            listingId: await buyableListing("ID"),
          },
        )
      ).json(),
    );
    const refused = await post(
      "/api/checkout",
      { cookie: session.cookie, "idempotency-key": randomUUID() },
      { checkoutId: quote.checkoutId },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "insufficient_available" });
    expect((await deps.sagas.findById(quote.checkoutId))?.state).toBe("quoted");
  });

  it("never sells an AU reward to an ID account", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const refused = await post(
      "/api/checkout/quote",
      { cookie: session.cookie },
      {
        listingId: await buyableListing("AU"),
      },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "region_mismatch" });
  });

  it("keeps online rewards for established accounts", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const refused = await post(
      "/api/checkout/quote",
      { cookie: session.cookie },
      {
        listingId: await buyableListing("ID", "online"),
      },
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "audience_blocked" });
  });

  it("refuses someone else's checkout", async () => {
    const buyer = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const stranger = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const quote = checkoutQuoteSchema.parse(
      (
        await post(
          "/api/checkout/quote",
          { cookie: buyer.cookie },
          { listingId: await buyableListing("ID") },
        )
      ).json(),
    );
    const refused = await post(
      "/api/checkout",
      { cookie: stranger.cookie, "idempotency-key": randomUUID() },
      { checkoutId: quote.checkoutId },
    );
    expect(refused.statusCode).toBe(404);
  });
});

describe("recovery", () => {
  it("finishes a saga the burn got through, and releases one it did not", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const quotes = [];
    for (let i = 0; i < 2; i++) {
      quotes.push(
        checkoutQuoteSchema.parse(
          (
            await post(
              "/api/checkout/quote",
              { cookie: session.cookie },
              {
                listingId: await buyableListing("ID"),
              },
            )
          ).json(),
        ),
      );
    }
    const [burnedThenCrashed, crashedBeforeBurn] = quotes as [
      (typeof quotes)[number],
      (typeof quotes)[number],
    ];
    await earn(session.userId, "ID", burnedThenCrashed.pricePoints);

    // Crash 1: reserved and burned, the saga row still says reserved.
    for (const quote of quotes) {
      const saga = await deps.sagas.findById(quote.checkoutId);
      if (saga === null) throw new Error("no saga");
      const reserved = await deps.vouchers.reserve({ listingId: saga.listingId, sagaId: saga.id });
      await deps.sagas.advance(saga.id, "quoted", "reserved", {
        voucherId: reserved._unsafeUnwrap().voucherId,
        reservedUntil: new Date(Date.now() - 60_000),
      });
    }
    const burned = await deps.ledger.burnForVoucher({
      userId: session.userId,
      listingId: burnedThenCrashed.listingId,
      points: toPoints(burnedThenCrashed.pricePoints),
      sagaId: burnedThenCrashed.checkoutId,
      quoteId: (await deps.sagas.findById(burnedThenCrashed.checkoutId))?.quoteId ?? "",
    });
    expect(burned.isOk()).toBe(true);

    await recoverSagas(deps);
    expect((await deps.sagas.findById(burnedThenCrashed.checkoutId))?.state).toBe("done");
    expect((await deps.sagas.findById(crashedBeforeBurn.checkoutId))?.state).toBe("released");
    // The balance is whole: one burn, nothing lost for the released one.
    expect(await available(session.userId)).toBe(0);
  });
});
