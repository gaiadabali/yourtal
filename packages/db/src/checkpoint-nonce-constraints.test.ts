import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, OWNER_URL } from "./database-urls";
import { seed } from "./seed";

/**
 * What makes a checkpoint token single-use, proved against real Postgres.
 * YT-0121.
 *
 * `watch-checkpoint-token.ts` can prove a token is ours and has not expired.
 * It cannot prove the token has not already been spent — a valid signature
 * stays valid, so the same bytes verify perfectly the second time. The
 * single-use guarantee lives entirely in this table, and specifically in two
 * UNIQUE constraints, so it is worth asserting here with no service in the
 * way: a connection holding the app credential must not be able to spend one
 * nonce twice, or answer one checkpoint twice.
 *
 * These tests need `pnpm dev:up`.
 *
 * ## The second constraint is the one that matters
 *
 * Nonce uniqueness is the obvious half and the weaker half. It stops the
 * SAME token being replayed and does nothing about a viewer who requests two
 * tokens for checkpoint 3 and spends both — each carries its own fresh
 * nonce, and both are legitimately signed by us. Only
 * `checkpoint_answered_once_per_session` stops that, and it is the reason
 * this file exists rather than a unit test over a `Set`.
 */

const { Pool } = pg;

let pool: pg.Pool;
let owner: pg.Pool;
let sessionId: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  await seed(owner);

  const { rows } = await pool.query<{ id: string; version: number }>(
    `SELECT c.id, t.version
       FROM campaign.campaigns c
       JOIN campaign.terms_version t ON t.campaign_id = c.id
      WHERE c.lifecycle_state = 'live'
      LIMIT 1`,
  );
  const campaign = rows[0];
  expect(campaign, "the seed should have produced a live campaign with terms").toBeDefined();

  sessionId = randomUUID();
  await pool.query(
    `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at)
     VALUES ($1, $2, $3, $4, 'active', now(), now())`,
    [sessionId, randomUUID(), campaign?.id, campaign?.version],
  );
});

beforeEach(async () => {
  // A clean start, not only a clean finish: a run that failed part-way would
  // otherwise leave rows that collide on the next one.
  await pool.query(`DELETE FROM watch.checkpoint_nonce WHERE session_id = $1`, [sessionId]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM watch.checkpoint_nonce WHERE session_id = $1`, [sessionId]);
  // As the OWNER, not the app. `yourtal_app` holds SELECT, INSERT, UPDATE on
  // `watch.session` and deliberately no DELETE — a session is history, and
  // the application has no business erasing one. Tearing down a fixture is
  // administration, which is the same split `database-urls.ts` describes for
  // seeding. Found by this suite's own cleanup being refused, which is the
  // grant working.
  await owner.query(`DELETE FROM watch.session WHERE id = $1`, [sessionId]);
  await pool.end();
  await owner.end();
});

async function spend(nonce: string, checkpointIndex: number): Promise<void> {
  await pool.query(
    `INSERT INTO watch.checkpoint_nonce (nonce, session_id, checkpoint_index, expires_at)
     VALUES ($1, $2, $3, now() + interval '90 seconds')`,
    [nonce, sessionId, checkpointIndex],
  );
}

describe("watch.checkpoint_nonce", () => {
  it("refuses the same nonce twice", async () => {
    const nonce = randomUUID();
    await spend(nonce, 0);

    await expect(spend(nonce, 0)).rejects.toThrow(/duplicate key|checkpoint_nonce_pkey/i);
  });

  it("refuses a second nonce for a checkpoint already answered", async () => {
    // The attack nonce uniqueness does not cover: two legitimately-signed
    // tokens for one checkpoint, obtained by asking twice. Both nonces are
    // fresh, so the primary key is satisfied by both.
    await spend(randomUUID(), 3);

    await expect(spend(randomUUID(), 3)).rejects.toThrow(
      /checkpoint_answered_once_per_session|duplicate key/i,
    );
  });

  it("allows different checkpoints in one session", async () => {
    await spend(randomUUID(), 0);
    await spend(randomUUID(), 1);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM watch.checkpoint_nonce WHERE session_id = $1`,
      [sessionId],
    );
    expect(rows[0]?.count).toBe("2");
  });

  it("settles a concurrent double-spend in the database, not in a service", async () => {
    // The race the whole design exists for. Two requests carrying one token
    // arrive together; both would read "unspent" under any check-then-act
    // scheme. Exactly one INSERT may survive.
    const nonce = randomUUID();
    const results = await Promise.allSettled([spend(nonce, 7), spend(nonce, 7)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  /**
   * Proves the two tests above can fail.
   *
   * A double-spend test that has only ever been seen passing has not been
   * shown to work — it would pass just as happily against a table with no
   * constraints at all, because `Promise.allSettled` on two inserts that
   * both succeed still returns two settled promises. So the same races are
   * run against a deliberately unconstrained copy, and the assertion is
   * inverted: BOTH must succeed there.
   *
   * The real table is never touched. Dropping its constraints to prove they
   * matter would leave a window in which they did not, on a shared database
   * with four sessions running — the proof would create the hole it was
   * demonstrating.
   */
  it("both spends succeed without the constraints, which is why they exist", async () => {
    const probe = `checkpoint_nonce_probe_${Date.now().toString()}`;
    await owner.query(
      `CREATE UNLOGGED TABLE watch.${probe} (
         nonce text, session_id uuid, checkpoint_index integer, expires_at timestamptz
       )`,
    );
    await owner.query(`GRANT SELECT, INSERT ON watch.${probe} TO yourtal_app`);

    try {
      const insert = (nonce: string, index: number) =>
        pool.query(
          `INSERT INTO watch.${probe} (nonce, session_id, checkpoint_index, expires_at)
           VALUES ($1, $2, $3, now())`,
          [nonce, sessionId, index],
        );

      // Same nonce twice — the replay the primary key stops.
      const replay = randomUUID();
      const replayed = await Promise.allSettled([insert(replay, 0), insert(replay, 0)]);
      expect(replayed.filter((r) => r.status === "fulfilled")).toHaveLength(2);

      // Two fresh nonces on one checkpoint — the attack that nonce
      // uniqueness alone would never have caught, and the reason
      // `checkpoint_answered_once_per_session` is on the table.
      const twoTokens = await Promise.allSettled([
        insert(randomUUID(), 1),
        insert(randomUUID(), 1),
      ]);
      expect(twoTokens.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    } finally {
      await owner.query(`DROP TABLE watch.${probe}`);
    }
  });

  it("refuses the app role UPDATE — a spend is a fact, not a draft", async () => {
    const nonce = randomUUID();
    await spend(nonce, 0);

    await expect(
      pool.query(`UPDATE watch.checkpoint_nonce SET checkpoint_index = 99 WHERE nonce = $1`, [
        nonce,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("grants the app role DELETE, because pruning past expiry loses nothing", async () => {
    // Deliberately unlike `watch.coverage`, which has no DELETE. Coverage is
    // the evidence a reward is paid against. A spent nonce past its expiry
    // is evidence of nothing — the signature layer refuses an expired token
    // before this table is consulted.
    await spend(randomUUID(), 0);
    const removed = await pool.query(
      `DELETE FROM watch.checkpoint_nonce WHERE session_id = $1 AND expires_at < now() + interval '1 day'`,
      [sessionId],
    );
    expect(removed.rowCount).toBe(1);
  });
});
