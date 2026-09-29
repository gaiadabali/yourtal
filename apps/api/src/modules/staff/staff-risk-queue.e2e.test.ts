import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor, type TestSession } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "./staff.test-helper";

/**
 * TASKS.md 10.5.a, 10.5.c's Check (the release half): a flagged account is
 * released from the queue. Over real HTTP, real Postgres and real Cerbos.
 * `LEDGER_MODE=fake` in this slot -- the fake ledger never runs the real Go
 * RiskGate (10.4), so this seeds `platform.ledger_fake_risk_flag` directly,
 * the same "own narrow SQL" convention `platform.ledger_fake_escrow`'s own
 * tests already use.
 */
let app: NestFastifyApplication;
let owner: Pool;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
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

async function seedBlockedFlag(): Promise<{ flagId: string; escrowId: string; userId: string }> {
  const userId = randomUUID();
  const escrowId = `esc_${randomUUID()}`;
  await owner.query(
    `INSERT INTO platform.ledger_fake_escrow (id, user_id, points, pending_points, reason, state)
     VALUES ($1, $2, 130, 0, 'risk: velocity_user', 'held')`,
    [escrowId, userId],
  );
  const flag = await owner.query<{ id: string }>(
    `INSERT INTO platform.ledger_fake_risk_flag (user_id, region, severity, reason, signals, escrow_id, status)
     VALUES ($1, 'AU', 'block', 'velocity_user', $2::jsonb, $3, 'pending')
     RETURNING id`,
    [userId, JSON.stringify([{ kind: "velocity_user", detail: "10 grants in 10m" }]), escrowId],
  );
  const flagId = flag.rows[0]?.id;
  if (flagId === undefined) throw new Error("failed to seed a fake risk flag");
  return { flagId, escrowId, userId };
}

describe("staff risk queue", () => {
  it("lists a pending flag for risk_analyst, and refuses support", async () => {
    const { flagId, userId } = await seedBlockedFlag();
    const risk = await staffSession("risk_analyst");

    const listed = await get("/api/staff/risk/queue?region=AU", risk);
    expect(listed.statusCode).toBe(200);
    const flags = listed.json<{ id: string; userId: string; severity: string; status: string }[]>();
    expect(flags.some((f) => f.id === flagId && f.userId === userId && f.severity === "block")).toBe(
      true,
    );

    const support = await staffSession("support");
    const refused = await get("/api/staff/risk/queue?region=AU", support);
    expect(refused.statusCode).toBe(403);
  });

  it("releases a flag, and releases the escrow it had auto-held", async () => {
    const { flagId, escrowId } = await seedBlockedFlag();
    const risk = await staffSession("risk_analyst");

    const released = await post(`/api/staff/risk/queue/${flagId}/release`, risk, {
      resolutionNote: "false positive, a real user on shared wifi",
    });
    expect(released.statusCode).toBe(201);
    const body = released.json<{ status: string }>();
    expect(body.status).toBe("released");

    const flagRow = await owner.query<{ status: string; resolved_by: string }>(
      `SELECT status, resolved_by FROM platform.ledger_fake_risk_flag WHERE id = $1`,
      [flagId],
    );
    expect(flagRow.rows[0]?.status).toBe("released");

    const escrowRow = await owner.query<{ state: string }>(
      `SELECT state FROM platform.ledger_fake_escrow WHERE id = $1`,
      [escrowId],
    );
    expect(escrowRow.rows[0]?.state).toBe("released");

    // No longer in the pending queue.
    const listed = await get("/api/staff/risk/queue?region=AU", risk);
    const flags = listed.json<{ id: string }[]>();
    expect(flags.some((f) => f.id === flagId)).toBe(false);

    // A second release attempt finds nothing pending.
    const again = await post(`/api/staff/risk/queue/${flagId}/release`, risk);
    expect(again.statusCode).toBe(404);
  });

  it("suspends a flag by holding the account's current balance into escrow", async () => {
    const userId = randomUUID();
    const flag = await owner.query<{ id: string }>(
      `INSERT INTO platform.ledger_fake_risk_flag (user_id, region, severity, reason, signals, status)
       VALUES ($1, 'AU', 'flag', 'timing_implausible', '[]'::jsonb, 'pending')
       RETURNING id`,
      [userId],
    );
    const flagId = flag.rows[0]?.id;
    if (flagId === undefined) throw new Error("failed to seed a fake risk flag");
    const risk = await staffSession("risk_analyst");

    const suspended = await post(`/api/staff/risk/queue/${flagId}/suspend`, risk, {
      resolutionNote: "confirmed farming after review",
    });
    expect(suspended.statusCode).toBe(201);
    expect(suspended.json<{ status: string }>().status).toBe("suspended");

    const flagRow = await owner.query<{ status: string }>(
      `SELECT status FROM platform.ledger_fake_risk_flag WHERE id = $1`,
      [flagId],
    );
    expect(flagRow.rows[0]?.status).toBe("suspended");
  });
});
