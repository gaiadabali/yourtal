import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Job } from "pg-boss";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "neverthrow";
import type { PointsUnlockedEvent } from "@yourtal/contracts/ledger-internal/releases";
import { toPoints } from "@yourtal/contracts/money";
import { loadWorkerConfig } from "../config";

/**
 * 12.4.b (#8): `createSimulatedPush`'s real outbox is in-memory and
 * module-private (`points-unlocked-notify.ts`'s own `const push = ...` at
 * module scope) -- unobservable from a test, which is exactly why the
 * "opted out" test below its own comment says so. Mocked here instead, so
 * "was a push actually attempted" becomes something this file CAN assert,
 * for the one new case that needs it: a teen's own missing-row default.
 * `vi.hoisted` because `vi.mock`'s factory runs before this file's own
 * top-level code, so `sendMock` must exist before that hoisting point.
 */
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@yourtal/drivers/push", () => ({
  createSimulatedPush: () => ({ mode: "simulated", send: sendMock }),
}));

import { job } from "./points-unlocked-notify";

/**
 * Real Postgres (YT-0547's `with-test-db.mjs`), the job's `handle()` called
 * directly — same shape as `points-unlocked.test.ts`'s own choice to test
 * the exported function rather than the whole `startWorker` loop, since
 * that loop is `worker.test.ts`'s own concern.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const config = loadWorkerConfig({ DATABASE_URL: DATABASE_URL });
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(ok({ id: "mock-push-id" }));
});

function fakeJob(data: PointsUnlockedEvent): Job<PointsUnlockedEvent> {
  return {
    id: randomUUID(),
    name: "ledger.points_unlocked",
    data,
    // The handler reads only `.data` — the rest of pg-boss's `Job` shape is irrelevant here.
  } as Job<PointsUnlockedEvent>;
}

describe("points-unlocked-notify job", () => {
  it("writes an in-app notification and sends a push when no preference exists (default: enabled)", async () => {
    const userId = randomUUID();
    const grantId = randomUUID();

    await job.handle(
      fakeJob({
        grantId,
        userId,
        region: "AU",
        points: toPoints(5),
        unlockedAt: new Date().toISOString(),
        idempotencyKey: `points_unlocked_${grantId}`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query<{ category: string; body: string }>(
      `SELECT category, body FROM me.notification WHERE user_id = $1`,
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.category).toBe("points_unlocked");
    expect(rows.rows[0]?.body).toContain("5 pts");
    // No profile row at all for this userId -- the fail-open branch
    // (`push-default.ts`'s own header: no profile to prove a teen).
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  // 12.4.b (#8): the DPIA's own default -- a teen with no explicit
  // preference row gets no push, an adult with no row does. Distinct from
  // the "opted out" test below: no row exists at all here, so this proves
  // the DEFAULT, not an explicit choice being honoured.
  it("a teen with no preference row gets the in-app notification but no push", async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await pool.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Push Default Teen', '2012-01-01', 'Australia/Sydney')`,
      [userId],
    );

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z")); // 10:00 AEST -- not quiet hours
      await job.handle(
        fakeJob({
          grantId,
          userId,
          region: "AU",
          points: toPoints(5),
          unlockedAt: new Date().toISOString(),
          idempotencyKey: `points_unlocked_${grantId}`,
        }),
        { boss: undefined as never, config },
      );

      const rows = await pool.query(`SELECT 1 FROM me.notification WHERE user_id = $1`, [userId]);
      expect(rows.rows).toHaveLength(1);
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await pool.query(`DELETE FROM identity.user_profile WHERE user_id = $1`, [userId]);
    }
  });

  it("an adult with no preference row gets the push", async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await pool.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Push Default Adult', '1990-01-01', 'Australia/Sydney')`,
      [userId],
    );

    try {
      await job.handle(
        fakeJob({
          grantId,
          userId,
          region: "AU",
          points: toPoints(5),
          unlockedAt: new Date().toISOString(),
          idempotencyKey: `points_unlocked_${grantId}`,
        }),
        { boss: undefined as never, config },
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query(`DELETE FROM identity.user_profile WHERE user_id = $1`, [userId]);
    }
  });

  it("still writes the notification, but skips the push, when the user opted out", async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await pool.query(
      `INSERT INTO me.notification_preference (user_id, category, push_enabled) VALUES ($1, 'points_unlocked', false)`,
      [userId],
    );

    await job.handle(
      fakeJob({
        grantId,
        userId,
        region: "AU",
        points: toPoints(12),
        unlockedAt: new Date().toISOString(),
        idempotencyKey: `points_unlocked_${grantId}`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query(`SELECT 1 FROM me.notification WHERE user_id = $1`, [userId]);
    expect(rows.rows).toHaveLength(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // 12.2.b: quiet hours (21:00-07:00, the teen's own profile timezone)
  // silence this notification entirely -- no row, no push.
  it("silences a teen during quiet hours, but not the same teen outside them", async () => {
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Quiet Hours Teen', '2012-01-01', 'Australia/Sydney')`,
      [userId],
    );

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T11:00:00.000Z")); // 21:00 AEST
      await job.handle(
        fakeJob({
          grantId: randomUUID(),
          userId,
          region: "AU",
          points: toPoints(5),
          unlockedAt: new Date().toISOString(),
          idempotencyKey: `points_unlocked_${randomUUID()}`,
        }),
        { boss: undefined as never, config },
      );
      const duringQuietHours = await pool.query(
        `SELECT 1 FROM me.notification WHERE user_id = $1`,
        [userId],
      );
      expect(duringQuietHours.rows).toHaveLength(0);

      vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z")); // 10:00 AEST
      await job.handle(
        fakeJob({
          grantId: randomUUID(),
          userId,
          region: "AU",
          points: toPoints(5),
          unlockedAt: new Date().toISOString(),
          idempotencyKey: `points_unlocked_${randomUUID()}`,
        }),
        { boss: undefined as never, config },
      );
      const outsideQuietHours = await pool.query(
        `SELECT 1 FROM me.notification WHERE user_id = $1`,
        [userId],
      );
      expect(outsideQuietHours.rows).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      await pool.query(`DELETE FROM identity.user_profile WHERE user_id = $1`, [userId]);
    }
  });
});
