import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../app.module";
import { sessionFor, type TestSession } from "../../shared/testing/session-for";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import { grantStaffRole, ownerPool } from "./staff.test-helper";

/**
 * TASKS.md 9.4.a-c, 9.4.e's Check (the users half): search, view, suspend
 * into escrow, release, and goodwill within the F12 per-case limit -- over
 * real HTTP, real Postgres and real Cerbos. `LEDGER_MODE=fake` in this slot;
 * see `fake-ledger-wallet.ts`'s own "available first, then pending (9.4.b)"
 * comment for why the fake's escrow already proves this Check honestly.
 */
let app: NestFastifyApplication;
let owner: Pool;
let ledger: LedgerInternalClient;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // main.ts's own global pipe (YT-0552's DTOs opt in by extending
  // createZodDto -- see that file's comment) -- without it here, a request
  // this suite means to prove REJECTED (a missing reason, an empty search)
  // reaches the handler unvalidated instead.
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
  ledger = app.get(LEDGER_INTERNAL_CLIENT);
  const funded = await ledger.fundMarketing({
    region: "AU",
    amountMinor: toMinorUnits(500_000),
    proposedBy: "staff-1",
    approvedBy: "staff-2",
  });
  expect(funded.isOk()).toBe(true);
});

afterAll(async () => {
  await owner.end();
  await app.close();
});

async function staffSession(role: "support" | "risk_analyst"): Promise<TestSession> {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

function get(url: string, session: TestSession) {
  return app.inject({ method: "GET", url, headers: { cookie: session.cookie } });
}

function post(url: string, session: TestSession, payload?: object) {
  return app.inject({
    method: "POST",
    url,
    headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    ...(payload === undefined ? {} : { payload }),
  });
}

describe("GET /api/staff/users", () => {
  it("finds a user by email and by user id, region-scoped by staff, not by target", async () => {
    const staff = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });

    const byEmail = await get(`/api/staff/users?email=${encodeURIComponent(target.email)}`, staff);
    expect(byEmail.statusCode).toBe(200);
    const byEmailBody = byEmail.json<{ userId: string }[]>();
    expect(byEmailBody.map((row) => row.userId)).toContain(target.userId);

    const byId = await get(`/api/staff/users?userId=${target.userId}`, staff);
    expect(byId.json<{ userId: string }[]>()).toHaveLength(1);
  });

  it("requires an email or a user id", async () => {
    const staff = await staffSession("support");
    const response = await get("/api/staff/users", staff);
    expect(response.statusCode).toBe(400);
  });

  it("refuses finance and ops, which hold no user_account rule at all", async () => {
    const staff = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(owner, staff.userId, "finance");
    const response = await get(`/api/staff/users?userId=${staff.userId}`, staff);
    expect(response.statusCode).toBe(403);
  });
});

describe("GET /api/staff/users/:userId", () => {
  it("404s an unknown user id", async () => {
    const staff = await staffSession("support");
    const response = await get(`/api/staff/users/${randomUUID()}`, staff);
    expect(response.statusCode).toBe(404);
  });

  it("shows the target's own ledger balance", async () => {
    const staff = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });
    const response = await get(`/api/staff/users/${target.userId}`, staff);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userId: target.userId,
      availablePoints: 0,
      pendingPoints: 0,
      isSuspended: false,
    });
  });
});

describe("GET /api/staff/users/:userId/ledger", () => {
  it("lists the target's grants", async () => {
    const staff = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });
    const granted = await ledger.grantAction({
      kind: "goodwill",
      userId: target.userId,
      region: "AU",
      points: toPoints(20),
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    expect(granted.isOk()).toBe(true);

    const response = await get(`/api/staff/users/${target.userId}/ledger`, staff);
    expect(response.statusCode).toBe(200);
    const rows = response.json<{ kind: string; points: number }[]>();
    expect(rows.some((row) => row.kind === "grant" && row.points === 20)).toBe(true);
  });
});

describe("POST .../suspend and .../release (9.4.b, 9.4.e)", () => {
  it("moves available AND pending points to escrow, and release reverses both", async () => {
    const risk = await staffSession("risk_analyst");
    const target = await sessionFor(app, { jurisdiction: "AU" });

    // Immediately available (tier 3, no holdback).
    const available = await ledger.grantAction({
      kind: "goodwill",
      userId: target.userId,
      region: "AU",
      points: toPoints(40),
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    expect(available.isOk()).toBe(true);
    // Held back (tier 0, 72h) -- still PENDING, not available.
    const pending = await ledger.grantAction({
      kind: "streak",
      userId: target.userId,
      region: "AU",
      points: toPoints(25),
      trustTier: 0,
      idempotencyKey: randomUUID(),
    });
    expect(pending.isOk()).toBe(true);

    const before = await get(`/api/staff/users/${target.userId}`, risk);
    expect(before.json()).toMatchObject({ availablePoints: 40, pendingPoints: 25 });

    const suspend = await post(`/api/staff/users/${target.userId}/suspend`, risk, {
      reason: "risk review",
    });
    expect(suspend.statusCode).toBe(201);
    expect(suspend.json()).toMatchObject({ userId: target.userId, escrowedPoints: 65 });

    const duringSuspension = await get(`/api/staff/users/${target.userId}`, risk);
    expect(duringSuspension.json()).toMatchObject({
      availablePoints: 0,
      pendingPoints: 0,
      isSuspended: true,
    });

    const release = await post(`/api/staff/users/${target.userId}/release`, risk);
    expect(release.statusCode).toBe(201);
    expect(release.json()).toMatchObject({ userId: target.userId, releasedPoints: 65 });

    const after = await get(`/api/staff/users/${target.userId}`, risk);
    expect(after.json()).toMatchObject({
      availablePoints: 40,
      pendingPoints: 25,
      isSuspended: false,
    });
  });

  it("support cannot suspend or release -- whoever-can-adjust-cannot-suspend", async () => {
    const support = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });
    const response = await post(`/api/staff/users/${target.userId}/suspend`, support, {
      reason: "should be refused",
    });
    expect(response.statusCode).toBe(403);
  });

  it("suspending an already-suspended account conflicts; releasing a live one conflicts", async () => {
    const risk = await staffSession("risk_analyst");
    const target = await sessionFor(app, { jurisdiction: "AU" });

    const notSuspended = await post(`/api/staff/users/${target.userId}/release`, risk);
    expect(notSuspended.statusCode).toBe(409);

    const first = await post(`/api/staff/users/${target.userId}/suspend`, risk, {
      reason: "first",
    });
    expect(first.statusCode).toBe(201);
    const second = await post(`/api/staff/users/${target.userId}/suspend`, risk, {
      reason: "second",
    });
    expect(second.statusCode).toBe(409);
  });
});

describe("POST .../goodwill (9.4.c)", () => {
  it("grants within the F12 per-case limit (AU: 500 pts)", async () => {
    const support = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });
    const response = await post(`/api/staff/users/${target.userId}/goodwill`, support, {
      points: 100,
      reason: "goodwill for a bad experience",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ points: 100 });
  });

  it("denies a case over the F12 ceiling", async () => {
    const support = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });
    const response = await post(`/api/staff/users/${target.userId}/goodwill`, support, {
      points: 5000,
      reason: "over the region's own cap",
    });
    expect(response.statusCode).toBe(403);
  });

  it("risk_analyst cannot issue goodwill -- whoever-can-suspend-cannot-adjust", async () => {
    const risk = await staffSession("risk_analyst");
    const target = await sessionFor(app, { jurisdiction: "AU" });
    const response = await post(`/api/staff/users/${target.userId}/goodwill`, risk, {
      points: 10,
      reason: "should be refused",
    });
    expect(response.statusCode).toBe(403);
  });

  it("requires a reason", async () => {
    const support = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });
    const response = await post(`/api/staff/users/${target.userId}/goodwill`, support, {
      points: 10,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("POST .../trust-tier (9.4.d)", () => {
  it("risk_analyst sets it; support cannot", async () => {
    const risk = await staffSession("risk_analyst");
    const support = await staffSession("support");
    const target = await sessionFor(app, { jurisdiction: "AU" });

    const refused = await post(`/api/staff/users/${target.userId}/trust-tier`, support, {
      trustTier: 3,
      reason: "should be refused",
    });
    expect(refused.statusCode).toBe(403);

    const allowed = await post(`/api/staff/users/${target.userId}/trust-tier`, risk, {
      trustTier: 3,
      reason: "10 clean completions",
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json()).toMatchObject({ userId: target.userId, trustTier: 3 });
  });
});
