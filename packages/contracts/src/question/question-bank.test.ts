import { describe, expect, it } from "vitest";
import {
  ANSWER_KEY_FIELDS,
  presentedQuestionSchema,
  toPresentedQuestion,
} from "./presented-question";
import {
  BANK_MULTIPLE,
  MAX_QUESTIONS_ASKED,
  bankQuestionSchema,
  type BankQuestion,
  describeApprovalRefusal,
  judgeBankForApproval,
  populationAccuracy,
  questionsAskedFor,
  requiredBankSize,
} from "./question-bank";
import { questionSchema, type Question } from "./question";

const CAMPAIGN = "00000000-0000-4000-8000-00000000c001";

/** One of each type, so the answer-key check covers all five. */
const ONE_OF_EACH: Question[] = [
  questionSchema.parse({
    id: "00000000-0000-4000-8000-00000000a001",
    campaignId: CAMPAIGN,
    prompt: "Which drink was shown?",
    timerSeconds: 20,
    type: "multiple_choice",
    options: [
      { id: "00000000-0000-4000-8000-00000000b001", label: "Kopi susu" },
      { id: "00000000-0000-4000-8000-00000000b002", label: "Teh tarik" },
    ],
    correctOptionId: "00000000-0000-4000-8000-00000000b001",
  }),
  questionSchema.parse({
    id: "00000000-0000-4000-8000-00000000a002",
    campaignId: CAMPAIGN,
    prompt: "The shop opens at 7am.",
    timerSeconds: 15,
    type: "true_false",
    correctAnswer: true,
  }),
  questionSchema.parse({
    id: "00000000-0000-4000-8000-00000000a003",
    campaignId: CAMPAIGN,
    prompt: "How likely are you to visit?",
    timerSeconds: 20,
    type: "likert",
    scaleMin: 1,
    scaleMax: 5,
    scaleLowLabel: "Tidak mungkin",
    scaleHighLabel: "Sangat mungkin",
  }),
  questionSchema.parse({
    id: "00000000-0000-4000-8000-00000000a004",
    campaignId: CAMPAIGN,
    prompt: "Rank these by appeal.",
    timerSeconds: 30,
    type: "ranked",
    items: [
      { id: "00000000-0000-4000-8000-00000000b003", label: "Price" },
      { id: "00000000-0000-4000-8000-00000000b004", label: "Taste" },
    ],
  }),
  questionSchema.parse({
    id: "00000000-0000-4000-8000-00000000a005",
    campaignId: CAMPAIGN,
    prompt: "What stood out?",
    timerSeconds: 45,
    type: "short_text",
    maxLength: 200,
  }),
];

describe("a presented question cannot carry the answer", () => {
  /**
   * Risk 46. `questionSchema` holds `correctOptionId` and `correctAnswer`,
   * and `apps/web`'s scoring module — client-side by its own header —
   * imports it. So the key travels to the browser today and the score is
   * computed by the thing being scored.
   *
   * Checked against the exported field list rather than two hand-picked
   * names, so a sixth question type with a new kind of key fails here
   * instead of passing because nobody thought to add an assertion.
   */
  it.each(ONE_OF_EACH)("strips no key from a $type question because it has none", (question) => {
    const presented = toPresentedQuestion(question);
    for (const field of ANSWER_KEY_FIELDS) {
      expect(Object.keys(presented)).not.toContain(field);
    }
    expect(presentedQuestionSchema.safeParse(presented).success).toBe(true);
  });

  it("STRIPS an answer field from a hand-assembled object", () => {
    // I first asserted this was REJECTED, and it is not — Zod strips unknown
    // keys by default. Stripping is the better behaviour for an outbound
    // shape and the assertion was the thing that was wrong: a rejection
    // would throw while serving a response, and the tempting fix for that
    // is a `catch` that returns the unparsed object — with the key in it.
    // Stripping cannot fail open.
    const smuggled = { ...toPresentedQuestion(ONE_OF_EACH[1]!), correctAnswer: true };
    const parsed = presentedQuestionSchema.parse(smuggled);

    expect(Object.keys(parsed)).not.toContain("correctAnswer");
    expect("correctAnswer" in parsed).toBe(false);
  });

  it("keeps everything a viewer legitimately needs", () => {
    const presented = toPresentedQuestion(ONE_OF_EACH[0]!);
    expect(presented).toMatchObject({
      prompt: "Which drink was shown?",
      timerSeconds: 20,
      type: "multiple_choice",
    });
    // The options must survive — a question with no choices is unanswerable,
    // and "strip everything" would be a safe-looking way to break the quiz.
    expect(presented.type === "multiple_choice" ? presented.options : []).toHaveLength(2);
  });
});

describe("how many questions a campaign asks", () => {
  const table = [
    { durationSeconds: 0, expected: 0 },
    { durationSeconds: 60, expected: 0 },
    { durationSeconds: 299, expected: 0 },
    { durationSeconds: 300, expected: 1 },
    { durationSeconds: 900, expected: 3 },
    { durationSeconds: 1_500, expected: 5 },
    { durationSeconds: 1_800, expected: 5 },
    { durationSeconds: 10_800, expected: 5 },
  ];

  it.each(table)("$durationSeconds seconds asks $expected", ({ durationSeconds, expected }) => {
    expect(questionsAskedFor(durationSeconds)).toBe(expected);
  });

  it("never exceeds the cap however long the video", () => {
    expect(questionsAskedFor(60 * 60 * 24)).toBe(MAX_QUESTIONS_ASKED);
  });

  it("requires three times what it asks", () => {
    expect(requiredBankSize(1_800)).toBe(5 * BANK_MULTIPLE);
    expect(requiredBankSize(900)).toBe(3 * BANK_MULTIPLE);
    expect(requiredBankSize(60)).toBe(0);
  });
});

function bankOf(count: number, overrides: Partial<BankQuestion> = {}): BankQuestion[] {
  return Array.from({ length: count }, (_unused, index) =>
    bankQuestionSchema.parse({
      questionId: `00000000-0000-4000-8000-0000000b${String(index).padStart(4, "0")}`,
      campaignId: CAMPAIGN,
      status: "approved",
      piiScreen: "clear",
      timesAsked: 0,
      timesCorrect: 0,
      retiredReason: null,
      ...overrides,
    }),
  );
}

describe("approving a campaign's bank", () => {
  it("approves a bank at exactly three times the ask", () => {
    expect(judgeBankForApproval(bankOf(15), 1_800)).toBe("approved");
  });

  it("REFUSES a bank one short", () => {
    // Enforced at approval, not suggested in the editor. A suggestion is
    // what an advertiser dismisses at 2am before a launch.
    const refusal = judgeBankForApproval(bankOf(14), 1_800);
    expect(refusal).toMatchObject({ kind: "bank_too_small", have: 14, need: 15 });
    // Narrowed rather than asserted: `packages/contracts` bans type
    // assertions, and this is why — the narrowing also proves the function
    // did not return "approved", which an `as` would have hidden.
    if (refusal !== "approved") {
      expect(describeApprovalRefusal(refusal)).toContain("3x");
    }
  });

  it("does not count drafts toward the size", () => {
    // A bank padded with drafts satisfies a raw count and leaves nothing
    // askable — and the failure would land at the checkpoint, after the
    // viewer had already watched the whole video.
    const mixed = [...bankOf(10), ...bankOf(5, { status: "draft" })];
    expect(judgeBankForApproval(mixed, 1_800)).toMatchObject({ kind: "bank_too_small", have: 10 });
  });

  it("does not count retired questions", () => {
    const mixed = [...bankOf(10), ...bankOf(5, { status: "retired", retiredReason: "leaked" })];
    expect(judgeBankForApproval(mixed, 1_800)).toMatchObject({ kind: "bank_too_small", have: 10 });
  });

  it("REFUSES an approved question that has not been screened for PII", () => {
    // docs/18 section 6. A reward-gated question is a uniquely effective way
    // to harvest data a business could not otherwise ask for, because the
    // viewer is mid-reward and motivated to answer.
    const unscreened = [...bankOf(14), ...bankOf(1, { piiScreen: null })];
    expect(judgeBankForApproval(unscreened, 1_800)).toMatchObject({ kind: "unscreened" });
  });

  it("REFUSES a bank containing a question the screen rejected", () => {
    const rejected = [...bankOf(15), ...bankOf(1, { piiScreen: "rejected" })];
    expect(judgeBankForApproval(rejected, 1_800)).toMatchObject({ kind: "screen_rejected" });
  });

  it("treats needs_review as not yet clear", () => {
    // Distinct from rejected on purpose: "a human has not looked" is a
    // different fact from "a human said no", and collapsing them either
    // blocks legitimate questions or waves borderline ones through.
    const pending = [...bankOf(14), ...bankOf(1, { piiScreen: "needs_review" })];
    expect(judgeBankForApproval(pending, 1_800)).toMatchObject({ kind: "unscreened" });
  });

  it("says a short campaign needs no bank at all", () => {
    const verdict = judgeBankForApproval([], 60);
    expect(verdict).toMatchObject({ kind: "no_questions_required" });
  });
});

describe("population accuracy, for leak detection", () => {
  it("is null before anybody has answered", () => {
    // A rate from zero answers is not 0% — it is unknown, and a detector
    // that reads it as 0% fires on every new question.
    expect(populationAccuracy(bankOf(1)[0]!)).toBeNull();
  });

  it("is derived from the counters rather than stored", () => {
    // Counters, not a rate: a stored rate loses the denominator, and "97%"
    // from four answers cannot be told from "97%" from four thousand. A leak
    // detector that cannot tell those apart fires on noise and gets muted.
    const question = bankQuestionSchema.parse({
      ...bankOf(1)[0]!,
      timesAsked: 100,
      timesCorrect: 61,
    });
    expect(populationAccuracy(question)).toBeCloseTo(0.61, 5);
  });

  it("shows the jump docs/18 section 11 describes", () => {
    const before = bankQuestionSchema.parse({
      ...bankOf(1)[0]!,
      timesAsked: 100,
      timesCorrect: 61,
    });
    const after = bankQuestionSchema.parse({
      ...bankOf(1)[0]!,
      timesAsked: 200,
      timesCorrect: 158,
    });
    // 61% then 97% on the next hundred — the signal an auto-retire would
    // watch for. Nothing retires automatically yet; this asserts the shape
    // makes the statistic a read rather than a recomputation.
    expect(populationAccuracy(before)).toBeCloseTo(0.61, 5);
    expect((158 - 61) / 100).toBeCloseTo(0.97, 5);
    expect(populationAccuracy(after)).toBeGreaterThan(populationAccuracy(before) ?? 0);
  });

  it("keeps a reason when a question is retired", () => {
    // Retire, never delete. A deleted question takes its own evidence with
    // it, and the cohort that answered it could no longer be identified.
    const retired = bankOf(1, {
      status: "retired",
      retiredReason: "accuracy jumped 61% to 97%",
    })[0];
    expect(retired?.retiredReason).toContain("97%");
  });
});
