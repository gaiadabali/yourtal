import { createHmac, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { partnerCredentials } from "./persistence/schema/partner.table";

/**
 * TASKS.md 8.4.a's Check, over the real HTTP stack: a real partner HMAC
 * signature, a real 5.4.c link code issued through its own real endpoint, a
 * real ledger grant, and the real wallet balance it lands in -- the same
 * shape `billing.controller.e2e.test.ts` uses for its own HTTP-round-trip
 * proof. `owner` (not the app's own `yourtal_app` role) seeds the partner
 * credential directly: `yourtal_app` only has SELECT on
 * `platform.partner_credential` (the migration's own grant), same as this
 * suite's siblings seed fixtures no endpoint exists to create.
 */
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // `rawBody: true` is the NestApplicationOptions main.ts itself passes to
  // `NestFactory.create` (not a FastifyAdapter option) -- without it,
  // `request.rawBody` the partner-auth HMAC verifies against is never
  // populated, and every signature check here would trivially fail.
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function seedPartner(): Promise<{ partnerId: string; secret: string }> {
  const partnerId = `test-partner-${randomUUID()}`;
  const secret = `test-only-partner-secret-${randomUUID()}`;
  await owner.insert(partnerCredentials).values({ partnerId, secret });
  return { partnerId, secret };
}

function signedHeaders(partnerId: string, secret: string, rawBody: string, idempotencyKey: string) {
  const signature = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return {
    authorization: `Partner ${partnerId}:${signature}`,
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  };
}

describe("POST /api/partners/actions (8.4.a)", () => {
  it("grants AU's receipt_points (10) once, replays idempotently, and refuses a second receipt", async () => {
    const { partnerId, secret } = await seedPartner();
    const session = await sessionFor(app, { jurisdiction: "AU" });

    const codeResponse = await app.inject({
      method: "POST",
      url: "/api/me/linked-apps/code",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(codeResponse.statusCode).toBe(201);
    const { code } = codeResponse.json<{ code: string }>();

    const externalRef = `receipt-${randomUUID()}`;
    const rawBody = JSON.stringify({
      user: code,
      action: "receipt_scanned",
      externalRef,
      evidence: { ocr: "$4.50 coffee" },
    });
    const idempotencyKey = randomUUID();

    const first = await app.inject({
      method: "POST",
      url: "/api/partners/actions",
      headers: signedHeaders(partnerId, secret, rawBody, idempotencyKey),
      payload: rawBody,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ granted: true, points: 10 });

    // The real DB row: the wallet's own available balance moved by exactly
    // AU's receipt_points (20260925193000_platform_region_setting.sql), via
    // trust tier 3 -- landed available, never held back.
    const wallet = await app.inject({
      method: "GET",
      url: "/api/wallet",
      headers: { cookie: session.cookie },
    });
    expect(wallet.json<{ availablePoints: number }>().availablePoints).toBe(10);

    // A replay with the identical idempotency key + body hands back the
    // same grant rather than a second one (the idempotency interceptor,
    // ahead of grantPartnerAction ever running again).
    const replay = await app.inject({
      method: "POST",
      url: "/api/partners/actions",
      headers: signedHeaders(partnerId, secret, rawBody, idempotencyKey),
      payload: rawBody,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ granted: true, points: 10 });

    const walletAfterReplay = await app.inject({
      method: "GET",
      url: "/api/wallet",
      headers: { cookie: session.cookie },
    });
    expect(walletAfterReplay.json<{ availablePoints: number }>().availablePoints).toBe(10);

    // The SAME receipt under a fresh idempotency key (not a replay of the
    // first call) is still refused: partner_receipt's own (partner, hash)
    // uniqueness, not just the idempotency table, is what stops a second
    // grant for one physical receipt.
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/partners/actions",
      headers: signedHeaders(partnerId, secret, rawBody, randomUUID()),
      payload: rawBody,
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("refuses a signature made with the wrong secret", async () => {
    const { partnerId } = await seedPartner();
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const codeResponse = await app.inject({
      method: "POST",
      url: "/api/me/linked-apps/code",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    const { code } = codeResponse.json<{ code: string }>();

    const rawBody = JSON.stringify({
      user: code,
      action: "receipt_scanned",
      externalRef: `receipt-${randomUUID()}`,
      evidence: {},
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/partners/actions",
      headers: signedHeaders(partnerId, "not-the-real-secret", rawBody, randomUUID()),
      payload: rawBody,
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses an unknown or expired link code", async () => {
    const { partnerId, secret } = await seedPartner();

    const rawBody = JSON.stringify({
      user: "NOT-A-REAL-CODE",
      action: "receipt_scanned",
      externalRef: `receipt-${randomUUID()}`,
      evidence: {},
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/partners/actions",
      headers: signedHeaders(partnerId, secret, rawBody, randomUUID()),
      payload: rawBody,
    });
    expect(response.statusCode).toBe(400);
  });
});
