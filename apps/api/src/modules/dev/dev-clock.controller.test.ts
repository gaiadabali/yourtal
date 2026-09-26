import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";

/**
 * `response.json()` is typed `any`. Each call site below reads it into an
 * `unknown` local first, then asserts its own shape — going through
 * `unknown` (rather than asserting directly on the `any` expression) is
 * what makes that assertion a real narrowing instead of the no-op
 * `@typescript-eslint/no-unnecessary-type-assertion` would otherwise reject.
 */
function rawJson(response: Awaited<ReturnType<NestFastifyApplication["inject"]>>): unknown {
  return response.json();
}

/**
 * 2.3.d — a real HTTP round trip through the actual `AppModule` (same
 * mechanism `app.boot.test.ts` uses), against real Postgres: this suite
 * seeds `platform.ledger_fake_grant` rows directly (the same table
 * `FakeLedgerClient` itself writes to), calls each `/api/dev/clock` route,
 * and reads the resulting rows back — the released/shifted `unlock_at`, the
 * `platform.dev_clock_audit` row, and the enqueued `pgboss.job` row.
 *
 * No `LEDGER_MODE` override here: this suite's DATABASE_URL/env is
 * unset for it, same as `app.boot.test.ts`, so it exercises the default
 * (`fake`) — the mode this worktree and CI both run in.
 */

let app: NestFastifyApplication;
let db: AppDb;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
});

afterAll(async () => {
  await app.close();
});

/** A pending grant, unlock_at N hours from now, for one user. Mirrors
 * `insertGrant` in `fake-ledger-rewards.ts` — same table, same columns. */
async function seedPendingGrant(userId: string, hoursFromNow: number): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO platform.ledger_fake_grant
      (id, kind, user_id, region, points, unlock_at, idempotency_key)
    VALUES (${id}, 'goodwill', ${userId}, 'AU', 100,
            now() + (${hoursFromNow} || ' hours')::interval, ${`test_${id}`})
  `);
  return id;
}

async function grantUnlockAt(id: string): Promise<Date> {
  const result = await db.execute<{ unlock_at: string }>(
    sql`SELECT unlock_at FROM platform.ledger_fake_grant WHERE id = ${id}`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no grant ${id}`);
  return new Date(row.unlock_at);
}

async function latestAuditRow(
  userId: string,
): Promise<{ action: string; detail: Record<string, unknown> } | undefined> {
  const result = await db.execute<{ action: string; detail: Record<string, unknown> }>(sql`
    SELECT action, detail FROM platform.dev_clock_audit
     WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1
  `);
  return result.rows[0];
}

describe("GET /api/dev/clock/jobs", () => {
  it("lists the one built job and refuses an anonymous caller with 401, not 403 (F30)", async () => {
    const anon = await app.inject({ method: "GET", url: "/api/dev/clock/jobs" });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ code: "no_session" });

    const session = await sessionFor(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/dev/clock/jobs",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = rawJson(response) as { jobs: { key: string; built: boolean }[] };
    const pointsUnlocked = body.jobs.find((job) => job.key === "points-unlocked");
    expect(pointsUnlocked?.built).toBe(true);
    // Every other job TASKS.md 2.3.d names is not yet built — not faked.
    expect(body.jobs.filter((job) => job.built).length).toBe(1);
  });
});

describe("POST /api/dev/clock/release-pending", () => {
  it("releases the caller's own pending grant, and only the caller's", async () => {
    const session = await sessionFor(app);
    const grantId = await seedPendingGrant(session.userId, 48);

    const other = await sessionFor(app);
    const otherGrantId = await seedPendingGrant(other.userId, 48);

    const response = await app.inject({
      method: "POST",
      url: "/api/dev/clock/release-pending",
      headers: { cookie: session.cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ ledgerMode: "fake", released: 1 });

    expect((await grantUnlockAt(grantId)).getTime()).toBeLessThanOrEqual(Date.now());
    // The other caller's grant is untouched.
    expect((await grantUnlockAt(otherGrantId)).getTime()).toBeGreaterThan(Date.now());

    const audit = await latestAuditRow(session.userId);
    expect(audit?.action).toBe("release_pending");
    expect(audit?.detail).toMatchObject({ released: 1 });
  });

  it("refuses an anonymous caller with 401, not 403 (F30)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/clock/release-pending",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "no_session" });
  });
});

describe("POST /api/dev/clock/advance-days", () => {
  it("shifts a still-pending grant's unlock_at earlier by N days", async () => {
    const session = await sessionFor(app);
    const grantId = await seedPendingGrant(session.userId, 72); // 3 days out
    const before = await grantUnlockAt(grantId);

    const response = await app.inject({
      method: "POST",
      url: "/api/dev/clock/advance-days",
      headers: { cookie: session.cookie },
      payload: { days: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ ledgerMode: "fake", days: 1, shifted: 1 });

    const after = await grantUnlockAt(grantId);
    const shiftedMs = before.getTime() - after.getTime();
    // ~1 day, allowing generous slack for test wall-clock time.
    expect(shiftedMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(shiftedMs).toBeLessThan(25 * 60 * 60 * 1000);
    expect(after.getTime()).toBeGreaterThan(Date.now()); // still pending

    const audit = await latestAuditRow(session.userId);
    expect(audit).toMatchObject({ action: "advance_days", detail: { days: 1, shifted: 1 } });
  });

  it("can advance a grant past its unlock time, making it available", async () => {
    const session = await sessionFor(app);
    const grantId = await seedPendingGrant(session.userId, 2); // 2 hours out

    const response = await app.inject({
      method: "POST",
      url: "/api/dev/clock/advance-days",
      headers: { cookie: session.cookie },
      payload: { days: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect((rawJson(response) as { shifted: number }).shifted).toBe(1);
    expect((await grantUnlockAt(grantId)).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects a non-positive day count as a 400, not a silent no-op", async () => {
    const session = await sessionFor(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/clock/advance-days",
      headers: { cookie: session.cookie },
      payload: { days: 0 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/dev/clock/run-job", () => {
  it("enqueues an immediate run of ledger.release_notices, leaving a pgboss row behind", async () => {
    const session = await sessionFor(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/clock/run-job",
      headers: { cookie: session.cookie },
      payload: { job: "points-unlocked" },
    });
    expect(response.statusCode).toBe(200);
    const body = rawJson(response) as { queue: string; jobId: string };
    expect(body.queue).toBe("ledger.release_notices");

    const row = await db.execute<{ name: string }>(
      sql`SELECT name FROM pgboss.job WHERE id = ${body.jobId}::uuid`,
    );
    expect(row.rows[0]?.name).toBe("ledger.release_notices");

    const audit = await latestAuditRow(session.userId);
    expect(audit).toMatchObject({ action: "run_job", detail: { job: "points-unlocked" } });
  });

  it("rejects a job that has not been built yet", async () => {
    const session = await sessionFor(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/clock/run-job",
      headers: { cookie: session.cookie },
      payload: { job: "holdback-release" },
    });
    expect(response.statusCode).toBe(400);
  });
});
