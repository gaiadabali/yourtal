import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutQuoteSchema } from "@yourtal/contracts/checkout/checkout";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../../app.module";
import { createAppDb, type AppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { SAGA_DEPS } from "../checkout.tokens";
import { recoverSagas } from "./recover-sagas";
import { runSaga, type SagaDeps } from "./run-saga";

// The saga when a service does not answer at all (found by 4.7.d's live run):
// an unreachable voucher service or ledger rejects instead of refusing.

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

const unreachable = () => Promise.reject(new TypeError("fetch failed"));

/** `client` with some methods swapped out (a spread would drop a class's methods). */
function patched<T extends object>(client: T, patch: Partial<T>): T {
  return new Proxy(client, {
    get: (target, key, receiver) =>
      key in patch ? patch[key as keyof T] : Reflect.get(target, key, receiver),
  });
}

/** A reserved saga whose reservation has lapsed, for an ID buyer holding its price. */
async function reservedSaga(): Promise<{ sagaId: string; userId: string }> {
  const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
  const rows = await owner.execute<{ id: string }>(sql`
    UPDATE store.listings SET lifecycle_state = 'active', status = 'available', stock_remaining = stock_total,
           expires_at = now() + interval '30 days', audience = 'all_ages', channel = 'in_store'
     WHERE id = (SELECT id FROM store.listings WHERE region = 'ID' ORDER BY random() LIMIT 1)
    RETURNING id::text`);
  const quoted = await app.inject({
    method: "POST",
    url: "/api/checkout/quote",
    headers: { cookie: session.cookie },
    payload: { listingId: rows.rows[0]?.id },
  });
  const quote = checkoutQuoteSchema.parse(quoted.json());
  const granted = await deps.ledger.grantAction({
    kind: "goodwill",
    userId: session.userId,
    region: "ID",
    points: toPoints(quote.pricePoints),
    trustTier: 3,
    idempotencyKey: randomUUID(),
  });
  expect(granted.isOk()).toBe(true);
  const reserved = await deps.vouchers.reserve({
    listingId: quote.listingId,
    sagaId: quote.checkoutId,
  });
  await deps.sagas.advance(quote.checkoutId, "quoted", "reserved", {
    voucherId: reserved._unsafeUnwrap().voucherId,
    reservedUntil: new Date(Date.now() - 60_000),
  });
  return { sagaId: quote.checkoutId, userId: session.userId };
}

describe("a service that does not answer", () => {
  it("an unreachable voucher service after the burn leaves the saga burned, not thrown", async () => {
    const { sagaId, userId } = await reservedSaga();
    const down: SagaDeps = { ...deps, vouchers: patched(deps.vouchers, { activate: unreachable }) };
    const saga = await deps.sagas.findById(sagaId);
    if (saga === null) throw new Error("no saga");

    const ran = await runSaga(down, saga);
    expect(ran._unsafeUnwrap().state).toBe("burned");
    expect(await recoverSagas(down)).toMatchObject({ finished: 0 });
    expect((await deps.sagas.findById(sagaId))?.state).toBe("burned");

    await recoverSagas(deps);
    expect((await deps.sagas.findById(sagaId))?.state).toBe("done");
    expect((await deps.ledger.balance(userId))._unsafeUnwrap().availablePoints).toBe(0);
  });

  it("an unreachable ledger never releases a voucher whose points may be spent", async () => {
    const { sagaId, userId } = await reservedSaga();
    const saga = await deps.sagas.findById(sagaId);
    if (saga === null) throw new Error("no saga");
    // The burn landed; then the ledger went dark before recovery could ask.
    expect(
      (
        await deps.ledger.burnForVoucher({
          userId,
          listingId: saga.listingId,
          points: saga.pricePoints,
          sagaId,
          quoteId: saga.quoteId,
        })
      ).isOk(),
    ).toBe(true);
    const dark: SagaDeps = { ...deps, ledger: patched(deps.ledger, { getBurn: unreachable }) };

    expect((await recoverSagas(dark)).released).toBe(0);
    expect((await deps.sagas.findById(sagaId))?.state).toBe("reserved");

    await recoverSagas(deps);
    expect((await deps.sagas.findById(sagaId))?.state).toBe("done");
  });
});
