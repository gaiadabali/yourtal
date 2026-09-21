import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Question } from "./question";
import { ANSWER_KEY_FIELDS } from "./presented-question";
import { selectQuestionsForSession } from "./question-selection";

const SECRET = "test-secret-not-a-real-one";
const CAMPAIGN = "7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

function multipleChoice(index: number): Question {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    campaignId: CAMPAIGN,
    type: "multiple_choice",
    prompt: `Question ${String(index)}`,
    timerSeconds: 20,
    options: [0, 1, 2, 3].map((ordinal) => ({
      id: `00000000-0000-4000-9000-${String(index * 10 + ordinal).padStart(12, "0")}`,
      label: `Option ${String(ordinal)}`,
    })),
    correctOptionId: `00000000-0000-4000-9000-${String(index * 10).padStart(12, "0")}`,
  };
}

const BANK = Array.from({ length: 12 }, (_, index) => multipleChoice(index + 1));

const select = (overrides: Partial<Parameters<typeof selectQuestionsForSession>[0]> = {}) =>
  selectQuestionsForSession({
    sessionId: CAMPAIGN,
    bank: BANK,
    count: 4,
    secret: SECRET,
    ...overrides,
  });

describe("selecting a session's questions", () => {
  it("asks the requested number and never repeats one inside a sitting", () => {
    const asked = select();
    expect(asked).toHaveLength(4);
    expect(new Set(asked.map((question) => question.id)).size).toBe(4);
  });

  it("is deterministic, so reloading cannot shop for an easier question", () => {
    // If a refresh redrew, a viewer could reroll until they got one they
    // knew. The draw is a pure function of session and secret, so it cannot.
    expect(select()).toEqual(select());
  });

  it("gives two sessions different questions", () => {
    const mine = select().map((question) => question.id);
    const theirs = select({ sessionId: randomUUID() }).map((question) => question.id);
    expect(theirs).not.toEqual(mine);
  });

  it("is unguessable without the secret", () => {
    expect(select({ secret: "somebody-elses-guess" }).map((q) => q.id)).not.toEqual(
      select().map((q) => q.id),
    );
  });

  it("returns fewer rather than repeating when the bank cannot cover the ask", () => {
    // A repeated question inside one sitting tells the viewer the bank is
    // exhausted, which is a hint about its size they should not get.
    const asked = select({ bank: BANK.slice(0, 2), count: 5 });
    expect(asked).toHaveLength(2);
    expect(new Set(asked.map((question) => question.id)).size).toBe(2);
  });

  it("returns nothing for an empty bank or a zero ask", () => {
    expect(select({ bank: [] })).toEqual([]);
    expect(select({ count: 0 })).toEqual([]);
  });

  /**
   * The property the 3x bank exists to produce.
   *
   * Across many sessions the four asked must range over the whole bank —
   * if selection collapsed onto a fixed subset, a leak of that subset would
   * cover every viewer and `question-bank.ts`'s ratio would buy nothing.
   */
  it("ranges over the entire bank across sessions", () => {
    const seen = new Set<string>();
    for (let run = 0; run < 60; run += 1) {
      for (const question of select({ sessionId: `session-${String(run)}` })) {
        seen.add(question.id);
      }
    }
    expect(seen.size).toBe(BANK.length);
  });
});

describe("shuffling options", () => {
  it("does not present every session the same option order", () => {
    const orders = new Set<string>();
    for (let run = 0; run < 40; run += 1) {
      for (const question of select({ sessionId: `s-${String(run)}` })) {
        if (question.type === "multiple_choice") {
          orders.add(`${question.id}:${question.options.map((o) => o.id).join(",")}`);
        }
      }
    }
    // Far more distinct orderings than there are questions — i.e. the same
    // question genuinely appears in different orders, not one order each.
    expect(orders.size).toBeGreaterThan(BANK.length);
  });

  it("keeps every option, losing and inventing none", () => {
    for (const question of select()) {
      if (question.type !== "multiple_choice") continue;
      const source = BANK.find((candidate) => candidate.id === question.id);
      expect(source).toBeDefined();
      if (source?.type !== "multiple_choice") continue;
      expect(new Set(question.options.map((o) => o.id))).toEqual(
        new Set(source.options.map((o) => o.id)),
      );
    }
  });

  it("gives two questions in one sitting different permutations", () => {
    // Seeded by session AND question id. With a session-only seed, learning
    // one question's order would give the next one's.
    const perQuestion = new Set(
      select({ count: 8 }).flatMap((question) =>
        question.type === "multiple_choice"
          ? [question.options.map((option) => option.label).join(",")]
          : [],
      ),
    );
    expect(perQuestion.size).toBeGreaterThan(1);
  });
});

describe("the answer key", () => {
  /**
   * The reason this function returns `PresentedQuestion` rather than
   * `Question`: a selected question cannot carry its key out, by type. This
   * asserts it at runtime too, because the type only protects callers who
   * are compiled against it.
   */
  it("never travels with a selected question", () => {
    for (const question of select({ count: BANK.length })) {
      for (const field of ANSWER_KEY_FIELDS) {
        expect(question).not.toHaveProperty(field);
      }
    }
  });
});
