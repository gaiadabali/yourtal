import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutQuoteSchema, checkoutResultSchema } from "@yourtal/contracts/checkout/checkout";
import { disputeResultSchema } from "@yourtal/contracts/checkout/dispute";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../app.module";
import { createAppDb, type AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor, type TestSession } from "../../shared/testing/session-for";
import { SAGA_DEPS } from "./checkout.tokens";
import type { SagaDeps } from "./use-cases/run-saga";

// 4.7.c, K13, over real HTTP against the configured clients (the fakes in CI).

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
  const funded = await deps.ledger.fundMarketing({
    region: "ID",
    amountMinor: toMinorUnits(50_000_000),
    proposedBy: "staff-1",
    approvedBy: "staff-2",
  });
  expect(funded.isOk()).toBe(true);
});

afterAll(async () => {
  await app.close();
});

function post(url: string, session: TestSession, payload: object) {
  return app.inject({
    method: "POST",
    url,
    headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    payload,
  });
}

/** A viewer who bought one ID voucher and spent every point on it. */
async function bought(): Promise<{ session: TestSession; voucherId: string; price: number }> {
  const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
  const listing = await owner.execute<{ id: string }>(sql`
    UPDATE store.listings SET lifecycle_state = 'active', status = 'available', stock_remaining = stock_total,
           expires_at = now() + interval '30 days', audience = 'all_ages', channel = 'in_store'
     WHERE id = (SELECT id FROM store.listings WHERE region = 'ID' ORDER BY random() LIMIT 1)
    RETURNING id::text`);
  const quote = checkoutQuoteSchema.parse(
    (await post("/api/checkout/quote", session, { listingId: listing.rows[0]?.id })).json(),
  );
  const granted = await deps.ledger.grantAction({
    kind: "goodwill",
    userId: session.userId,
    region: "ID",
    points: toPoints(quote.pricePoints),
    trustTier: 3,
    idempotencyKey: randomUUID(),
  });
  expect(granted.isOk()).toBe(true);
  const result = checkoutResultSchema.parse(
    (await post("/api/checkout", session, { checkoutId: quote.checkoutId })).json(),
  );
  return { session, voucherId: result.voucherId, price: quote.pricePoints };
}

async function available(userId: string): Promise<number> {
  return (await deps.ledger.balance(userId))._unsafeUnwrap().availablePoints;
}

describe("POST /api/wallet/vouchers/:id/dispute", () => {
  it("voids an uncaptured voucher and returns the exact points at once, once", async () => {
    const { session, voucherId, price } = await bought();
    expect(await available(session.userId)).toBe(0);

    const first = await post(`/api/wallet/vouchers/${voucherId}/dispute`, session, {
      reason: "not_honoured",
    });
    expect(first.statusCode).toBe(200);
    expect(disputeResultSchema.parse(first.json())).toEqual({
      voucherId,
      outcome: "reinstated",
      points: price,
    });
    expect(await available(session.userId)).toBe(price);

    // A retried dispute under a fresh key gives nothing twice.
    const again = await post(`/api/wallet/vouchers/${voucherId}/dispute`, session, {
      reason: "not_honoured",
    });
    expect(disputeResultSchema.parse(again.json()).outcome).toBe("reinstated");
    expect(await available(session.userId)).toBe(price);
  });

  it("queues a voucher the merchant already took for staff, returning nothing yet", async () => {
    const { session, voucherId } = await bought();
    // The fake has no captured state; a voucher no longer active refuses a
    // void exactly the way a captured one does.
    await owner.execute(
      sql`UPDATE platform.voucher_fake_voucher SET state = 'released' WHERE id = ${voucherId}`,
    );

    const queued = await post(`/api/wallet/vouchers/${voucherId}/dispute`, session, {
      reason: "merchant_closed",
    });
    expect(queued.statusCode).toBe(200);
    expect(disputeResultSchema.parse(queued.json())).toEqual({
      voucherId,
      outcome: "queued",
      points: 0,
    });
    expect(await available(session.userId)).toBe(0);
    const row = await owner.execute<{ outcome: string }>(
      sql`SELECT outcome FROM checkout.dispute WHERE voucher_id = ${voucherId}::uuid`,
    );
    expect(row.rows[0]?.outcome).toBe("queued");
  });

  it("does not let anyone else dispute the voucher", async () => {
    const { voucherId } = await bought();
    const stranger = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const refused = await post(`/api/wallet/vouchers/${voucherId}/dispute`, stranger, {
      reason: "other",
    });
    expect(refused.statusCode).toBe(404);
  });
});
