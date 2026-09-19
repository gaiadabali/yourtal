import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, OWNER_URL } from "./database-urls";
import { seed } from "./seed";

/**
 * The watch session's constraints, against real Postgres. YT-0120.
 *
 * Every rule here is one an application-level check cannot enforce. "One
 * active session per user" loses a race; "coverage is evidence" is a grant,
 * not a convention; "the terms you agreed to" is a composite key or it is a
 * number nothing verifies.
 */

const { Pool } = pg;
/**
 * The owner, for cleanup only.
 *
 * The app role deliberately has no DELETE on `watch.session` — a session is
 * the record of an attempt, and one that can be erased is not a record. That
 * is the right grant and it means a test cannot tidy up as the app; the same
 * arrangement the daily-proof tests needed. Using the owner here keeps the
 * grant honest rather than widening it to make a test convenient.
 */

let pool: pg.Pool;
let owner: pg.Pool;

async function clearSessions(): Promise<void> {
  await owner.query(`DELETE FROM watch.session WHERE user_id = $1`, [userId]);
}
let campaignId: string;
const userId = "00000000-0000-4000-8000-00000000a001";

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  await seed(owner);
  // Cleanup at the START, not only at the end. A test that fails part-way
  // leaves its rows behind, and the next run then collides on the primary
  // key and fails for a reason that has nothing to do with what it tests —
  // which is how a real failure gets buried under a fake one. The same rule
  // the proof tests needed: repeatable means cleaning up before, not hoping
  // the last run got that far.
  await clearSessions();
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM campaign.campaigns WHERE lifecycle_state = 'live' LIMIT 1`,
  );
  campaignId = rows[0]?.id ?? "";
  expect(campaignId, "the seed should have produced a live campaign").not.toBe("");
});

afterAll(async () => {
  await clearSessions();
  await pool.end();
  await owner.end();
});

async function startSession(id: string, state = "active"): Promise<void> {
  await pool.query(
    `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, completed_at)
     VALUES ($1, $2, $3, 1, $4, CASE WHEN $4 = 'completed' THEN now() ELSE NULL END)`,
    [id, userId, campaignId, state],
  );
}

describe("one reward-bearing session per user", () => {
  beforeAll(async () => {
    await clearSessions();
  });

  it("REFUSES a second active session for the same user", async () => {
    // The rule the service cannot enforce. Two concurrent "start watching"
    // requests both read "no active session" and both insert; only a unique
    // index settles it.
    await startSession("00000000-0000-4000-8000-0000000000a1");

    await expect(startSession("00000000-0000-4000-8000-0000000000a2")).rejects.toThrow(
      /session_one_active_per_user/,
    );

    await clearSessions();
  });

  it("allows many non-active sessions, because those are history", async () => {
    // A user accumulates superseded and completed attempts over time. The
    // index is partial for exactly this reason — contention is only ever
    // about the one session currently earning.
    await startSession("00000000-0000-4000-8000-0000000000b1", "superseded");
    await startSession("00000000-0000-4000-8000-0000000000b2", "superseded");
    await startSession("00000000-0000-4000-8000-0000000000b3", "completed");
    await startSession("00000000-0000-4000-8000-0000000000b4");

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM watch.session WHERE user_id = $1`,
      [userId],
    );
    expect(Number(rows[0]?.n)).toBe(4);
    await clearSessions();
  });
});

describe("the terms a viewer entered under", () => {
  beforeAll(async () => {
    await clearSessions();
  });

  it("REFUSES a session against a terms version that does not exist", async () => {
    await expect(
      pool.query(
        `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state)
         VALUES ('00000000-0000-4000-8000-0000000000c1', $1, $2, 99, 'active')`,
        [userId, campaignId],
      ),
    ).rejects.toThrow(/session_campaign_id_terms_version_fkey|foreign key/i);
  });

  it("REFUSES a terms version belonging to a different campaign", async () => {
    // The composite key doing its job. Two independent ids that each exist
    // but do not belong together is exactly what a single-column foreign key
    // would have let through.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM campaign.campaigns WHERE id <> $1 LIMIT 1`,
      [campaignId],
    );
    const otherCampaign = rows[0]?.id ?? "";
    expect(otherCampaign).not.toBe("");

    // Give the other campaign a version 2 that this campaign does not have.
    await pool.query(
      `INSERT INTO campaign.terms_version
         (campaign_id, version, reward_points, question_count, scoring_rule,
          duration_seconds, effective_from)
       VALUES ($1, 2, 100, 0, 'base_only', 600, now())
       ON CONFLICT DO NOTHING`,
      [otherCampaign],
    );

    await expect(
      pool.query(
        `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state)
         VALUES ('00000000-0000-4000-8000-0000000000c2', $1, $2, 2, 'active')`,
        [userId, campaignId],
      ),
    ).rejects.toThrow(/foreign key|fkey/i);

    // Owner again: the app has SELECT and INSERT on `terms_version` and no
    // DELETE, because a frozen promise the app can erase is not frozen. The
    // grant is the feature; the test works around it rather than widening it.
    await owner.query(`DELETE FROM campaign.terms_version WHERE campaign_id = $1 AND version = 2`, [
      otherCampaign,
    ]);
  });
});

describe("coverage is evidence", () => {
  const sessionId = "00000000-0000-4000-8000-0000000000d1";

  beforeAll(async () => {
    await clearSessions();
    await startSession(sessionId);
    await pool.query(
      `INSERT INTO watch.coverage (session_id, from_second, to_second)
       VALUES ($1, 0, 60), ($1, 60, 120)`,
      [sessionId],
    );
  });

  it("REFUSES a span that does not move forwards", async () => {
    await expect(
      pool.query(
        `INSERT INTO watch.coverage (session_id, from_second, to_second) VALUES ($1, 100, 100)`,
        [sessionId],
      ),
    ).rejects.toThrow(/coverage_moves_forward/);
  });

  it("REFUSES a negative position", async () => {
    await expect(
      pool.query(
        `INSERT INTO watch.coverage (session_id, from_second, to_second) VALUES ($1, -5, 10)`,
        [sessionId],
      ),
    ).rejects.toThrow(/from_second/);
  });

  it("cannot be edited or deleted by the app role", async () => {
    // The same grant shape as `ledger.entry`. Evidence that can be rewritten
    // after the fact is not evidence — and this is what a reward is paid
    // against, so "the service would not do that" is not enforcement.
    await expect(
      pool.query(`UPDATE watch.coverage SET to_second = 9999 WHERE session_id = $1`, [sessionId]),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      pool.query(`DELETE FROM watch.coverage WHERE session_id = $1`, [sessionId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("keeps every reported span rather than a running total", async () => {
    // Derived, not stored: a total is a second copy a concurrent write can
    // corrupt, and a fraud review needs the SHAPE of what was claimed —
    // forty identical two-second spans at 3am looks nothing like a person.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM watch.coverage WHERE session_id = $1`,
      [sessionId],
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });
});

describe("a completed session says when", () => {
  beforeAll(async () => {
    await clearSessions();
  });

  it("REFUSES a completed session with no completion time", async () => {
    await clearSessions();
    await expect(
      pool.query(
        `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, completed_at)
         VALUES ('00000000-0000-4000-8000-0000000000e1', $1, $2, 1, 'completed', NULL)`,
        [userId, campaignId],
      ),
    ).rejects.toThrow(/session_completed_at_iff_completed/);
  });

  it("REFUSES an active session that claims a completion time", async () => {
    await expect(
      pool.query(
        `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, completed_at)
         VALUES ('00000000-0000-4000-8000-0000000000e2', $1, $2, 1, 'active', now())`,
        [userId, campaignId],
      ),
    ).rejects.toThrow(/session_completed_at_iff_completed/);
  });
});
