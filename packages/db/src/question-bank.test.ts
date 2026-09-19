import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, OWNER_URL } from "./database-urls";
import { seed } from "./seed";

/**
 * The question bank's constraints, against real Postgres. YT-0102.
 *
 * Every rule below is one an application check cannot enforce, and two of
 * them are the reason the schema is shaped the way it is: the answer key
 * lives in its own table so a `SELECT *` cannot return it, and a question
 * cannot reach `approved` without a clear PII screen.
 */

const { Pool } = pg;

/**
 * Fixtures are written as the OWNER, assertions run as the app.
 *
 * Seeding is administration. Since YT-0142 the app role can read a voucher
 * and not write one — the value path is split by role deliberately — so a
 * seed running as the app now lacks a grant it used to have. Widening the
 * app's grant to suit a fixture would undo the control; acquiring each
 * value-path role's grant in turn would break again the next time a role is
 * added. See `database-urls.ts`.
 */
let pool: pg.Pool;
let owner: pg.Pool;
let campaignId: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  await seed(owner);
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM campaign.campaigns WHERE lifecycle_state = 'live' LIMIT 1`,
  );
  campaignId = rows[0]?.id ?? "";
  expect(campaignId, "the seed should have produced a live campaign").not.toBe("");
});

// A clean start, not only a clean finish — a run that fails part-way would
// otherwise leave rows that collide on the next one.
beforeEach(async () => {
  await pool.query(`DELETE FROM campaign.question WHERE campaign_id = $1`, [campaignId]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM campaign.question WHERE campaign_id = $1`, [campaignId]);
  await pool.end();
  await owner.end();
});

async function insertQuestion(
  id: string,
  overrides: { status?: string; piiScreen?: string | null; retiredReason?: string | null } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO campaign.question
       (id, campaign_id, type, prompt, timer_seconds, status, pii_screen, retired_reason)
     VALUES ($1, $2, 'true_false', 'The shop opens at 7am.', 20, $3, $4, $5)`,
    [
      id,
      campaignId,
      overrides.status ?? "draft",
      overrides.piiScreen === undefined ? null : overrides.piiScreen,
      overrides.retiredReason ?? null,
    ],
  );
}

describe("a question cannot be approved without a clear PII screen", () => {
  it("REFUSES approved with no screen at all", async () => {
    // docs/18 section 6, as a constraint rather than a step a service might
    // skip. A reward-gated question is a uniquely effective way to harvest
    // data a business could not otherwise ask for.
    await expect(insertQuestion(randomUUID(), { status: "approved" })).rejects.toThrow(
      /question_approved_needs_clear_screen/,
    );
  });

  it("REFUSES approved when the screen said needs_review", async () => {
    await expect(
      insertQuestion(randomUUID(), { status: "approved", piiScreen: "needs_review" }),
    ).rejects.toThrow(/question_approved_needs_clear_screen/);
  });

  it("REFUSES approved when the screen rejected it", async () => {
    await expect(
      insertQuestion(randomUUID(), { status: "approved", piiScreen: "rejected" }),
    ).rejects.toThrow(/question_approved_needs_clear_screen/);
  });

  it("allows approved once the screen is clear", async () => {
    await insertQuestion(randomUUID(), { status: "approved", piiScreen: "clear" });
  });

  it("allows a draft to sit unscreened", async () => {
    // Screening gates APPROVAL, not authoring. Requiring it earlier would
    // mean screening every half-written prompt.
    await insertQuestion(randomUUID());
  });
});

describe("retirement carries its reason", () => {
  it("REFUSES a retired question with no reason", async () => {
    // docs/18 section 11 expects retirement to happen automatically on a
    // leak signal, and a retirement nobody can audit afterwards is not much
    // of a response.
    await expect(insertQuestion(randomUUID(), { status: "retired" })).rejects.toThrow(
      /question_retired_reason_iff_retired/,
    );
  });

  it("REFUSES a reason on a question that is not retired", async () => {
    await expect(
      insertQuestion(randomUUID(), { status: "draft", retiredReason: "left over" }),
    ).rejects.toThrow(/question_retired_reason_iff_retired/);
  });

  it("accepts a retirement with its reason", async () => {
    await insertQuestion(randomUUID(), {
      status: "retired",
      retiredReason: "population accuracy jumped 61% to 97% overnight",
    });
  });
});

describe("the answer key lives apart from the question", () => {
  it("is not returned by a SELECT * on the question", async () => {
    // The point of the split. `SELECT *` is the query somebody writes in a
    // hurry; serving the key has to be a deliberate join against a table
    // named `question_answer_key`.
    const id = randomUUID();
    await insertQuestion(id, { status: "approved", piiScreen: "clear" });
    await pool.query(
      `INSERT INTO campaign.question_answer_key (question_id, correct_answer) VALUES ($1, true)`,
      [id],
    );

    const { fields } = await pool.query(`SELECT * FROM campaign.question WHERE id = $1`, [id]);
    const columns = fields.map((field) => field.name);
    expect(columns).not.toContain("correct_answer");
    expect(columns).not.toContain("correct_option_id");
  });

  it("REFUSES a key with no shape at all", async () => {
    const id = randomUUID();
    await insertQuestion(id);
    await expect(
      pool.query(`INSERT INTO campaign.question_answer_key (question_id) VALUES ($1)`, [id]),
    ).rejects.toThrow(/answer_key_exactly_one_shape/);
  });

  it("REFUSES a key claiming two shapes at once", async () => {
    // A true/false question carrying a multiple-choice key is a scoring bug
    // that would only appear when somebody answered. A jsonb blob would have
    // made it representable.
    const id = randomUUID();
    await insertQuestion(id);
    await expect(
      pool.query(
        `INSERT INTO campaign.question_answer_key (question_id, correct_option_id, correct_answer)
         VALUES ($1, $2, true)`,
        [id, randomUUID()],
      ),
    ).rejects.toThrow(/answer_key_exactly_one_shape/);
  });

  it("cannot be DELETED by the app role", async () => {
    // A question whose key vanished would silently score every answer as
    // wrong, and the viewer who lost a reward would have no evidence that
    // anything had changed.
    const id = randomUUID();
    await insertQuestion(id);
    await pool.query(
      `INSERT INTO campaign.question_answer_key (question_id, correct_answer) VALUES ($1, false)`,
      [id],
    );

    await expect(
      pool.query(`DELETE FROM campaign.question_answer_key WHERE question_id = $1`, [id]),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("the accuracy counters", () => {
  it("REFUSES more correct answers than questions asked", async () => {
    // Counters rather than a stored rate, and the invariant that makes them
    // meaningful. A rate above 1 would be nonsense a detector would act on.
    const id = randomUUID();
    await insertQuestion(id);
    await expect(
      pool.query(
        `UPDATE campaign.question SET times_asked = 10, times_correct = 11 WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/question_correct_within_asked/);
  });

  it("starts both at zero, so accuracy is unknown rather than zero", async () => {
    const id = randomUUID();
    await insertQuestion(id);
    const { rows } = await pool.query<{ times_asked: string; times_correct: string }>(
      `SELECT times_asked, times_correct FROM campaign.question WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]?.times_asked)).toBe(0);
    expect(Number(rows[0]?.times_correct)).toBe(0);
  });
});
