import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";

/**
 * 7.5.c's Check, over the real HTTP stack: a simulated purchase appears as
 * a ledger purchase with its allocation, and a replay does not charge
 * twice. Real Cerbos (`billing.yaml` already existed before 7.5 -- this
 * suite is not the thing that first introduces that policy file), real
 * Postgres, `LEDGER_MODE=fake` (this suite's default) plus the simulated
 * payments driver (also the default -- `PAYMENTS_DRIVER` is unset).
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function ownerAt() {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  return { cookie: session.cookie, businessId };
}

describe("POST /api/:tenantId/studio/billing/purchases", () => {
  it("funds an allocation, and a replay with the same Idempotency-Key does not charge twice", async () => {
    const { cookie, businessId } = await ownerAt();
    const idempotencyKey = `test-${randomUUID()}`;

    const first = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload: { points: 1_000, currency: "AUD" },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ allocation: { remainingPoints: number; totalPoints: number } }>();
    expect(firstBody.allocation.totalPoints).toBe(1_000);
    expect(firstBody.allocation.remainingPoints).toBe(1_000);

    const balanceAfterFirst = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/balance`,
      headers: { cookie },
    });
    expect(balanceAfterFirst.json<{ totalPoints: number }>().totalPoints).toBe(1_000);

    const replay = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload: { points: 1_000, currency: "AUD" },
    });
    expect(replay.statusCode).toBe(201);

    const balanceAfterReplay = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/balance`,
      headers: { cookie },
    });
    // THE invariant: the replay did not create a second allocation.
    expect(balanceAfterReplay.json<{ totalPoints: number }>().totalPoints).toBe(1_000);
  });

  it("refuses a currency that does not match the business's own", async () => {
    const { cookie, businessId } = await ownerAt();

    const response = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
      // This business is AU/AUD -- IDR is refused, never silently charged in AUD instead (7.5.a).
      payload: { points: 1_000, currency: "IDR" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/:tenantId/studio/billing/purchases/quote", () => {
  it("shows a pack price with no backing rate anywhere in the response", async () => {
    const { cookie, businessId } = await ownerAt();

    const response = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/purchases/quote?points=1000`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ totalMinor: number; currency: string }>();
    expect(body.currency).toBe("AUD");
    expect(body.totalMinor).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/micros|backingRate/i);
  });
});
