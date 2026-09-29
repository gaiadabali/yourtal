import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { currencySchema } from "@yourtal/contracts/money/value";
import { AppModule } from "../../app.module";
import { sessionFor, type TestSession } from "../../shared/testing/session-for";
import { testDb } from "../../shared/testing/test-db";
import { generateStatementFake } from "../../shared/ledger-client/fake/fake-ledger-economy";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import { grantStaffRole, ownerPool } from "./staff.test-helper";

/**
 * TASKS.md 10.5.b/10.5.c: resolving a captured-voucher K13 dispute posts a
 * recovery line against the merchant and shows it on the merchant's next
 * statement. `LEDGER_MODE=fake` in this slot -- `fake-ledger-capture.ts`'s
 * own `recoverCapture` and `fake-ledger-economy.ts`'s own statement
 * generation both already exist for this exact purpose (the shared
 * contract spec, `ledger-client.contract.spec.ts`, already proves
 * `recoverCapture` itself against both the fake and a live ledger — this
 * test's own job is the STAFF path: authz, the dispute queue, and the
 * `staff.dispute_resolution` bookkeeping that finds a voucher's capture).
 */
let app: NestFastifyApplication;
let owner: Pool;
let ledger: LedgerInternalClient;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
  ledger = app.get(LEDGER_INTERNAL_CLIENT);
});

afterAll(async () => {
  await owner.end();
  await app.close();
});

async function staffSession(
  role: "support" | "finance",
  jurisdiction: "AU" | "ID",
): Promise<TestSession> {
  const session = await sessionFor(app, { jurisdiction });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

function post(url: string, session: TestSession, payload?: object) {
  return app.inject({
    method: "POST",
    url,
    // 12.3.d: `resolve` is now `@Idempotent` (mutating-routes.test.ts), same
    // header `staff-risk-queue.e2e.test.ts`'s own `post()` already sends.
    headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    ...(payload === undefined ? {} : { payload }),
  });
}

/**
 * A captured voucher and its own dispute, ready to resolve: reuses an
 * EXISTING seeded voucher's listing (so it carries a real merchant/currency
 * without this test re-running the whole issuance saga), and fabricates its
 * own authorization + capture + checkout saga/dispute rows around it --
 * this is the one thing `findCaptureIdForVoucher` needs that no seed
 * fixture provides on its own.
 */
async function seedCapturedDispute(): Promise<{
  voucherId: string;
  userId: string;
  merchantId: string;
  region: "AU" | "ID";
}> {
  const seeded = await owner.query<{
    id: string;
    merchant_id: string;
    currency: string;
    listing_id: string;
    location_id: string;
    region: "AU" | "ID";
  }>(
    `SELECT v.id, v.merchant_id, v.currency, v.listing_id, ll.location_id, v.region
       FROM voucher.vouchers v
       JOIN store.listing_location ll ON ll.listing_id = v.listing_id
      ORDER BY v.id LIMIT 1`,
  );
  const seed = seeded.rows[0];
  if (seed === undefined) throw new Error("expected at least one seeded voucher with a location");

  const voucherId = randomUUID();
  await owner.query(
    `INSERT INTO voucher.vouchers
       (id, listing_id, owner_id, merchant_id, merchant_name, title, face_value_minor,
        remaining_value_minor, partial_redemption_policy, transferable, issued_at,
        expires_at, location_id, state, currency, region)
     VALUES ($1, $2, $3, $4, 'Test Merchant', 'Test Voucher', 5000, 0, 'balance_carrying',
             false, now(), now() + interval '90 days', $5, 'redeemed', $6, $7)`,
    [
      voucherId,
      seed.listing_id,
      randomUUID(),
      seed.merchant_id,
      seed.location_id,
      seed.currency,
      seed.region,
    ],
  );

  const authorizationId = randomUUID();
  await owner.query(
    `INSERT INTO voucher.authorization
       (id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref, state, expires_at, resolved_at)
     VALUES ($1, $2, $3, 5000, $4, $5, 'captured', now() + interval '1 hour', now())`,
    [authorizationId, voucherId, seed.merchant_id, seed.currency, `order-${randomUUID()}`],
  );
  const captureId = randomUUID();
  await owner.query(
    `INSERT INTO voucher.capture (id, authorization_id, authorized_amount_minor, amount_minor, receipt_id)
     VALUES ($1, $2, 5000, 5000, $3)`,
    [captureId, authorizationId, `receipt-${randomUUID()}`],
  );
  // The ledger is a SEPARATE bookkeeping surface from the voucher schema
  // rows above (4.6.f.2: services/voucher's own outbox drainer is the real
  // caller in production) — recoverCapture looks this id up in the
  // ledger's own capture record, which only this call creates.
  (
    await ledger.captureVoucher({
      captureId,
      region: seed.region,
      merchantId: seed.merchant_id,
      amountMinor: toMinorUnits(5000),
      currency: currencySchema.parse(seed.currency),
    })
  )._unsafeUnwrap();

  const userId = randomUUID();
  const sagaId = randomUUID();
  await owner.query(
    `INSERT INTO checkout.saga
       (id, user_id, listing_id, region, currency, quote_id, price_points,
        settlement_minor, state, voucher_id, quote_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 100, 5000, 'burned', $7, now() + interval '1 hour')`,
    [sagaId, userId, seed.listing_id, seed.region, seed.currency, randomUUID(), voucherId],
  );
  await owner.query(
    `INSERT INTO checkout.dispute (voucher_id, saga_id, user_id, reason, outcome)
     VALUES ($1, $2, $3, 'not_honoured', 'queued')`,
    [voucherId, sagaId, userId],
  );

  return { voucherId, userId, merchantId: seed.merchant_id, region: seed.region };
}

describe("staff dispute resolution", () => {
  it("finance resolves a dispute, posting a recovery line; support cannot", async () => {
    const { voucherId, merchantId, region } = await seedCapturedDispute();
    const support = await staffSession("support", region);

    const refused = await post(`/api/staff/disputes/${voucherId}/resolve`, support, {
      reason: "K13: voucher not honoured",
    });
    expect(refused.statusCode).toBe(403);

    const finance = await staffSession("finance", region);
    const before = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const resolved = await post(`/api/staff/disputes/${voucherId}/resolve`, finance, {
      reason: "K13: voucher not honoured",
    });
    expect(resolved.statusCode).toBe(201);
    const body = resolved.json<{
      voucherId: string;
      recoveryPostingId: string;
      amountMinor: number;
      currency: string;
    }>();
    expect(body.voucherId).toBe(voucherId);
    expect(body.amountMinor).toBe(5000);
    expect(body.recoveryPostingId).toBeTruthy();

    // 10.5.c: the merchant's next statement carries the recovery line.
    const after = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const statement = await generateStatementFake(testDb(), {
      businessId: merchantId,
      region,
      from: before,
      to: after,
    });
    expect(statement.recoveriesMinor).toBe(5000);

    // The recovery is durably recorded, and the SAME dispute cannot be
    // resolved twice.
    const row = await owner.query<{ resolved_by: string }>(
      `SELECT resolved_by FROM staff.dispute_resolution WHERE voucher_id = $1`,
      [voucherId],
    );
    expect(row.rows).toHaveLength(1);

    const again = await post(`/api/staff/disputes/${voucherId}/resolve`, finance, {
      reason: "retry",
    });
    expect(again.statusCode).toBe(409);

    // Resolved disputes leave the queue.
    const queue = await app.inject({
      method: "GET",
      url: `/api/staff/disputes?region=${region}`,
      headers: { cookie: finance.cookie },
    });
    const queued = queue.json<{ voucherId: string }[]>();
    expect(queued.some((d) => d.voucherId === voucherId)).toBe(false);
  });
});
