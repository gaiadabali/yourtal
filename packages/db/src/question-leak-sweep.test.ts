import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { ANALYST_URL, APP_URL, OWNER_URL } from "./database-urls";
import { sweepForLeakedQuestions } from "./question-leak-sweep";

/**
 * The leak sweep, against real Postgres and the real analyst credential.
 * YT-0125.
 *
 * Run as the ANALYST, because that is the only role that can read
 * `campaign.question_response` — and proving the sweep works is therefore
 * also proving it cannot be run by the application. There is a test for
 * that below rather than a comment claiming it.
 *
 * Owns its entire fixture for the reason `question-response-constraints`
 * does: borrowing seeded rows put that suite in a race with two others.
 */

const { Pool } = pg;

let analyst: pg.Pool;
let app: pg.Pool;
let owner: pg.Pool;

const campaignId = "d2d2d2d2-0000-4000-8000-0000000c0125";
const merchantId = "d2d2d2d2-0000-4000-8000-0000000b0125";
const leakedQuestion = "d2d2d2d2-0000-4000-8000-00000000d125";
const steadyQuestion = "d2d2d2d2-0000-4000-8000-00000000e125";
const NOW = new Date("2026-09-22T12:00:00Z");
const OLD = new Date("2026-09-20T12:00:00Z");
const RECENT = new Date("2026-09-22T06:00:00Z");

async function makeQuestion(id: string): Promise<void> {
  await owner.query(
    `INSERT INTO campaign.question (id, campaign_id, type, prompt, timer_seconds, status, pii_screen)
     VALUES ($1, $2, 'true_false', 'Owned by question-leak-sweep.test.ts', 20, 'approved', 'clear')
     ON CONFLICT (id) DO NOTHING`,
    [id, campaignId],
  );
}

/** Answers written as the OWNER: the app may insert but this suite needs exact timestamps. */
async function answer(questionId: string, at: Date, count: number, correct: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const sessionId = randomUUID();
    await owner.query(
      `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at)
       VALUES ($1, $2, $3, 1, 'active', now(), now())`,
      [sessionId, randomUUID(), campaignId],
    );
    await owner.query(
      `INSERT INTO campaign.question_response
         (session_id, question_id, answered_bool, was_correct, latency_ms, answered_at)
       VALUES ($1, $2, true, $3, 2500, $4)`,
      [sessionId, questionId, index < correct, at],
    );
  }
}

beforeAll(async () => {
  analyst = new Pool({ connectionString: ANALYST_URL, max: 2 });
  app = new Pool({ connectionString: APP_URL, max: 2 });
  owner = new Pool({ connectionString: OWNER_URL, max: 4 });

  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at)
     VALUES ($1, 'long_form', 'leak sweep fixture', $2, 'Fixture Merchant',
             'Owned by question-leak-sweep.test.ts', 900, 20, 100, 1,
             'base_only', 'live', now())
     ON CONFLICT (id) DO NOTHING`,
    [campaignId, merchantId],
  );
  await owner.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, effective_from)
     VALUES ($1, 1, 100, 1, 'base_only', 900, now()) ON CONFLICT (campaign_id, version) DO NOTHING`,
    [campaignId],
  );
});

beforeEach(async () => {
  await owner.query(`DELETE FROM campaign.question_response WHERE question_id = ANY($1::uuid[])`, [
    [leakedQuestion, steadyQuestion],
  ]);
  await owner.query(`DELETE FROM watch.session WHERE campaign_id = $1`, [campaignId]);
  await owner.query(`DELETE FROM campaign.question WHERE id = ANY($1::uuid[])`, [
    [leakedQuestion, steadyQuestion],
  ]);
  await makeQuestion(leakedQuestion);
  await makeQuestion(steadyQuestion);
});

afterAll(async () => {
  await owner.query(`DELETE FROM campaign.question_response WHERE question_id = ANY($1::uuid[])`, [
    [leakedQuestion, steadyQuestion],
  ]);
  await owner.query(`DELETE FROM watch.session WHERE campaign_id = $1`, [campaignId]);
  await owner.query(`DELETE FROM campaign.question WHERE id = ANY($1::uuid[])`, [
    [leakedQuestion, steadyQuestion],
  ]);
  await owner.query(`DELETE FROM campaign.terms_version WHERE campaign_id = $1`, [campaignId]);
  await owner.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [campaignId]);
  await analyst.end();
  await app.end();
  await owner.end();
});

describe("the leak sweep", () => {
  it("retires a question whose population accuracy jumped", async () => {
    await answer(leakedQuestion, OLD, 40, 16); // 40%
    await answer(leakedQuestion, RECENT, 40, 40); // 100%

    const result = await sweepForLeakedQuestions(analyst, { now: NOW, retire: true });

    expect(result.retired.map((entry) => entry.questionId)).toContain(leakedQuestion);
    const { rows } = await owner.query<{ status: string; retired_reason: string }>(
      `SELECT status, retired_reason FROM campaign.question WHERE id = $1`,
      [leakedQuestion],
    );
    expect(rows[0]?.status).toBe("retired");
    expect(rows[0]?.retired_reason).toContain("40%");
    expect(rows[0]?.retired_reason).toContain("100%");
  });

  it("leaves a question whose accuracy is steady, however high", async () => {
    // An easy question is not a leaked one. Retiring on absolute accuracy
    // would delete the bank's best content first.
    await answer(steadyQuestion, OLD, 40, 38);
    await answer(steadyQuestion, RECENT, 40, 39);

    const result = await sweepForLeakedQuestions(analyst, { now: NOW, retire: true });

    expect(result.retired.map((entry) => entry.questionId)).not.toContain(steadyQuestion);
    const { rows } = await owner.query<{ status: string }>(
      `SELECT status FROM campaign.question WHERE id = $1`,
      [steadyQuestion],
    );
    expect(rows[0]?.status).toBe("approved");
  });

  /**
   * A sweep that retires on its first run in a new environment, before
   * anyone has seen what it would do, is how a detector deletes a bank.
   */
  it("reports without retiring unless asked", async () => {
    await answer(leakedQuestion, OLD, 40, 16);
    await answer(leakedQuestion, RECENT, 40, 40);

    const result = await sweepForLeakedQuestions(analyst, { now: NOW });

    expect(result.retired.map((entry) => entry.questionId)).toContain(leakedQuestion);
    const { rows } = await owner.query<{ status: string }>(
      `SELECT status FROM campaign.question WHERE id = $1`,
      [leakedQuestion],
    );
    expect(rows[0]?.status, "a dry run must not write").toBe("approved");
  });

  it("does not retire on a jump that is only visible in a tiny window", async () => {
    await answer(leakedQuestion, OLD, 40, 16);
    await answer(leakedQuestion, RECENT, 5, 5);

    const result = await sweepForLeakedQuestions(analyst, { now: NOW, retire: true });
    expect(result.retired).toEqual([]);
  });

  it("is idempotent: a second sweep does not re-retire", async () => {
    await answer(leakedQuestion, OLD, 40, 16);
    await answer(leakedQuestion, RECENT, 40, 40);

    await sweepForLeakedQuestions(analyst, { now: NOW, retire: true });
    const second = await sweepForLeakedQuestions(analyst, { now: NOW, retire: true });

    // The question is no longer `approved`, so it is out of scope entirely.
    expect(second.retired).toEqual([]);
  });

  /**
   * The boundary, restated as behaviour rather than as a grant.
   *
   * The sweep reads per-user answers, so the application role cannot run
   * it — and if it ever could, the control YT-0122 built would be gone.
   */
  it("CANNOT be run on the application's credential", async () => {
    await answer(leakedQuestion, OLD, 40, 16);
    await answer(leakedQuestion, RECENT, 40, 40);

    await expect(sweepForLeakedQuestions(app, { now: NOW })).rejects.toThrow(/permission denied/i);
  });
});
