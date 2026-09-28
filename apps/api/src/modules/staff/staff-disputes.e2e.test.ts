import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutQuoteSchema, checkoutResultSchema } from "@yourtal/contracts/checkout/checkout";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../app.module";
import { createAppDb, type AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor, type TestSession } from "../../shared/testing/session-for";
import { SAGA_DEPS } from "../checkout/checkout.tokens";
import type { SagaDeps } from "../checkout/use-cases/run-saga";
import { grantStaffRole, ownerPool } from "./staff.test-helper";

/**
 * TASKS.md 9.4.d, K13, and 9.4.e's Check (the dispute half): a captured
 * voucher's dispute lands in the staff queue. Reuses `dispute.controller
 * .test.ts`'s own recipe for producing a "queued" outcome (flip a bought
 * voucher's state so `voidVoucher` answers `already_granted`).
 */
let app: NestFastifyApplication;
let deps: SagaDeps;
let owner: AppDb;
let ownerPg: Pool;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  deps = app.get(SAGA_DEPS);
  owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
  ownerPg = ownerPool();
  const funded = await deps.ledger.fundMarketing({
    region: "ID",
    amountMinor: toMinorUnits(50_000_000),
    proposedBy: "staff-1",
    approvedBy: "staff-2",
  });
  expect(funded.isOk()).toBe(true);
});

afterAll(async () => {
  await ownerPg.end();
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

function get(url: string, session: TestSession) {
  return app.inject({ method: "GET", url, headers: { cookie: session.cookie } });
}

async function staffSession(role: "support" | "finance" | "risk_analyst"): Promise<TestSession> {
  const session = await sessionFor(app, { jurisdiction: "ID" });
  await grantStaffRole(ownerPg, session.userId, role);
  return session;
}

/** Same recipe as `checkout/dispute.controller.test.ts`'s own `bought()` + capture flip. */
async function queuedDispute(): Promise<{ voucherId: string; userId: string }> {
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
  // The merchant already took it -- voidVoucher answers `already_granted`,
  // which is what turns a dispute into `queued` rather than `reinstated`.
  await owner.execute(
    sql`UPDATE platform.voucher_fake_voucher SET state = 'released' WHERE id = ${result.voucherId}`,
  );
  const disputed = await post(`/api/wallet/vouchers/${result.voucherId}/dispute`, session, {
    reason: "merchant_closed",
  });
  expect(disputed.statusCode).toBe(200);
  expect(disputed.json<{ outcome: string }>().outcome).toBe("queued");
  return { voucherId: result.voucherId, userId: session.userId };
}

describe("GET /api/staff/disputes (9.4.d, K13)", () => {
  it("lists a captured-voucher dispute for support and finance", async () => {
    const { voucherId, userId } = await queuedDispute();
    const support = await staffSession("support");

    const response = await get("/api/staff/disputes", support);
    expect(response.statusCode).toBe(200);
    const rows = response.json<{ voucherId: string; userId: string; reason: string }[]>();
    const row = rows.find((entry) => entry.voucherId === voucherId);
    expect(row).toMatchObject({ userId, reason: "merchant_closed" });

    const finance = await staffSession("finance");
    const financeResponse = await get("/api/staff/disputes", finance);
    expect(financeResponse.statusCode).toBe(200);
  });

  it("refuses risk_analyst -- the zone is support and finance only", async () => {
    const risk = await staffSession("risk_analyst");
    const response = await get("/api/staff/disputes", risk);
    expect(response.statusCode).toBe(403);
  });
});
