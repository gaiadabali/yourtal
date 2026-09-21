import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, OWNER_URL } from "./database-urls";

/**
 * "Answers stored against the campaign, never exposed per-user to the
 * business", proved against real Postgres. YT-0122.
 *
 * The criterion is a property, so the test has to be one an application
 * cannot satisfy by being careful. These connect as `yourtal_app` — the
 * role every business-facing surface is served by — with no service in the
 * way, and check what that role can and cannot do. A service-level rule
 * would pass a unit test and be one forgotten call away from false.
 */

const { Pool } = pg;

let app: pg.Pool;
let owner: pg.Pool;
/** Fixed and unique to this suite, so no other file can reach them. */
const campaignId = "d1d1d1d1-0000-4000-8000-0000000c0122";
const merchantId = "d1d1d1d1-0000-4000-8000-0000000b0122";
const questionId = "d1d1d1d1-0000-4000-8000-00000000d122";
const optionId = "d1d1d1d1-0000-4000-9000-00000000d122";
const sessionId = "d1d1d1d1-0000-4000-8000-0000000e0122";

beforeAll(async () => {
  app = new Pool({ connectionString: APP_URL, max: 4 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });

  // This suite builds its ENTIRE fixture — campaign, terms, question,
  // option, session — rather than borrowing seeded rows, and that is not
  // fastidiousness. `question-bank.test.ts` clears every question for the
  // campaign it picks, and `seed.test.ts` counts rows; borrowing put this
  // file in a race with both, failing four tests in the full run while
  // passing alone. Owning the fixture means no other suite's cleanup or
  // counting can reach it, and this file writes nothing anyone else reads.
  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at)
     VALUES ($1, 'long_form', 'question-response-constraints fixture', $2,
             'Fixture Merchant', 'Owned by question-response-constraints.test.ts',
             900, 20, 100, 1, 'base_only', 'live', now())
     ON CONFLICT (id) DO NOTHING`,
    [campaignId, merchantId],
  );
  await owner.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule,
        duration_seconds, effective_from)
     VALUES ($1, 1, 100, 1, 'base_only', 900, now())
     ON CONFLICT (campaign_id, version) DO NOTHING`,
    [campaignId],
  );
  await owner.query(
    `INSERT INTO campaign.question (id, campaign_id, type, prompt, timer_seconds, status, pii_screen)
     VALUES ($1, $2, 'multiple_choice', 'Owned by question-response-constraints.test.ts', 20, 'approved', 'clear')
     ON CONFLICT (id) DO NOTHING`,
    [questionId, campaignId],
  );
  await owner.query(
    `INSERT INTO campaign.question_option (id, question_id, label, ordinal)
     VALUES ($1, $2, 'Option A', 0) ON CONFLICT (id) DO NOTHING`,
    [optionId, questionId],
  );
  await owner.query(
    `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at)
     VALUES ($1, $2, $3, 1, 'active', now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, randomUUID(), campaignId],
  );
});

beforeEach(async () => {
  await owner.query(`DELETE FROM campaign.question_response WHERE session_id = $1`, [sessionId]);
});

afterAll(async () => {
  await owner.query(`DELETE FROM campaign.question_response WHERE session_id = $1`, [sessionId]);
  await owner.query(`DELETE FROM watch.session WHERE id = $1`, [sessionId]);
  await owner.query(`DELETE FROM campaign.question_option WHERE id = $1`, [optionId]);
  await owner.query(`DELETE FROM campaign.question WHERE id = $1`, [questionId]);
  await owner.query(`DELETE FROM campaign.terms_version WHERE campaign_id = $1`, [campaignId]);
  await owner.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [campaignId]);
  await app.end();
  await owner.end();
});

function record(question = questionId, option: string | null = optionId) {
  return app.query(
    `INSERT INTO campaign.question_response
       (session_id, question_id, selected_option_id, was_correct, latency_ms)
     VALUES ($1, $2, $3, true, 2500)`,
    [sessionId, question, option],
  );
}

describe("campaign.question_response", () => {
  it("lets the app record an answer", async () => {
    await expect(record()).resolves.toBeDefined();
  });

  /**
   * The criterion, as a grant.
   *
   * Every business-facing surface is served by `yourtal_app`. If that role
   * cannot read these rows, no surface can render them — including
   * endpoints nobody has written yet. This is the difference between a
   * property and a convention.
   */
  it("REFUSES the app role any read of a per-user answer", async () => {
    await record();

    await expect(
      app.query(`SELECT * FROM campaign.question_response WHERE session_id = $1`, [sessionId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("REFUSES the app role a count, which would leak the same thing slowly", async () => {
    // A count is a read. Without this the business could learn one user's
    // answers by counting rows under a filter, one predicate at a time.
    await expect(
      app.query(`SELECT count(*) FROM campaign.question_response WHERE selected_option_id = $1`, [
        optionId,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("REFUSES the app role UPDATE and DELETE — a scored answer is a fact", async () => {
    await expect(
      app.query(`UPDATE campaign.question_response SET was_correct = false`),
    ).rejects.toThrow(/permission denied/i);
    await expect(app.query(`DELETE FROM campaign.question_response`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("still lets the business read the AGGREGATE, which is what it legitimately needs", async () => {
    // A merchant learning that 61% of viewers got question 3 right is the
    // signal they have an interest in; learning what one person answered is
    // not. The aggregate lives on the question row and stays readable.
    const { rows } = await app.query<{ times_asked: string }>(
      `SELECT times_asked::text FROM campaign.question WHERE id = $1`,
      [questionId],
    );
    expect(rows[0]?.times_asked).toBeDefined();
  });

  it("accepts one answer per question per session and refuses the second", async () => {
    await record();
    await expect(record()).rejects.toThrow(/question_answered_once_per_session|duplicate key/i);
  });

  it("REFUSES a response carrying no answer at all", async () => {
    // Without the CHECK, a row with both answer columns null and
    // `was_correct = false` is indistinguishable from a genuine wrong
    // answer, and the leak analysis reading these rows would score it as
    // one.
    await expect(record(questionId, null)).rejects.toThrow(
      /question_response_carries_an_answer|violates check/i,
    );
  });

  it("REFUSES a negative latency", async () => {
    await expect(
      app.query(
        `INSERT INTO campaign.question_response
           (session_id, question_id, selected_option_id, was_correct, latency_ms)
         VALUES ($1, $2, $3, true, -1)`,
        [sessionId, questionId, optionId],
      ),
    ).rejects.toThrow(/violates check|latency_ms/i);
  });
});
