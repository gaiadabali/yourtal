import { describe, expect, it } from "vitest";
import type { Campaign } from "@yourtal/contracts/campaign";
import { campaignSchema } from "@yourtal/contracts/campaign";
import type { Question } from "@yourtal/contracts/question";
import { questionSchema } from "@yourtal/contracts/question";
import type { Voucher } from "@yourtal/contracts/voucher";
import { voucherSchema } from "@yourtal/contracts/voucher";
import { toIdrMinorUnits } from "@yourtal/contracts/money";
import {
  aggregateQuestionTypeCounts,
  summarizeQuestionBank,
  summarizeRedemptionLedger,
} from "./reports-metrics";

function campaign(overrides: Partial<Campaign>): Campaign {
  return campaignSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    kind: "long_form",
    title: "Test campaign",
    merchantId: "00000000-0000-4000-8000-000000009901",
    merchantName: "Test Business",
    synopsis: "A synopsis long enough to pass validation.",
    durationSeconds: 600,
    estimatedDataMb: 200,
    rewardPoints: 1000,
    questionCount: 2,
    scoringRule: "base_only",
    status: "active",
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

function trueFalseQuestion(id: string, campaignId: string): Question {
  return questionSchema.parse({
    id,
    campaignId,
    prompt: "Was this true?",
    timerSeconds: 20,
    type: "true_false",
    correctAnswer: true,
  });
}

function multipleChoiceQuestion(id: string, campaignId: string): Question {
  return questionSchema.parse({
    id,
    campaignId,
    prompt: "Which one?",
    timerSeconds: 20,
    type: "multiple_choice",
    options: [
      { id: "00000000-0000-4000-8000-000000000201", label: "A" },
      { id: "00000000-0000-4000-8000-000000000202", label: "B" },
    ],
    correctOptionId: "00000000-0000-4000-8000-000000000201",
  });
}

function voucher(overrides: Partial<Voucher>): Voucher {
  const faceValueIdr = overrides.faceValueIdr ?? toIdrMinorUnits(50_000);
  return voucherSchema.parse({
    id: "00000000-0000-4000-8000-000000000301",
    listingId: "00000000-0000-4000-8000-000000000401",
    ownerId: "00000000-0000-4000-8000-000000000501",
    code: "ABCDEF1234",
    merchantId: "00000000-0000-4000-8000-000000009901",
    merchantName: "Test Business",
    title: "Test voucher",
    faceValueIdr,
    // Defaults to the (possibly overridden) faceValueIdr, never a fixed
    // literal — voucherSchema rejects remainingValueIdr > faceValueIdr, so a
    // fixed default here would break the moment a test overrides faceValueIdr
    // to something smaller.
    remainingValueIdr: faceValueIdr,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendIdr: null,
    transferable: false,
    status: "active",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("summarizeQuestionBank", () => {
  it("counts questions by type and always labels the row 'configured', never a performance tier", () => {
    const c = campaign({ id: "00000000-0000-4000-8000-000000000001", questionCount: 2 });
    const questions = [
      trueFalseQuestion("00000000-0000-4000-8000-000000000101", c.id),
      multipleChoiceQuestion("00000000-0000-4000-8000-000000000102", c.id),
    ];

    const [row] = summarizeQuestionBank([c], { [c.id]: questions });

    expect(row).toBeDefined();
    expect(row?.provenance).toBe("configured");
    expect(row?.typeCounts).toEqual([
      { type: "multiple_choice", label: "Multiple choice", count: 1 },
      { type: "true_false", label: "True / false", count: 1 },
    ]);
  });

  it("gives a campaign with no questions an empty typeCounts array, not a missing row", () => {
    const c = campaign({ id: "00000000-0000-4000-8000-000000000002", questionCount: 0 });
    const [row] = summarizeQuestionBank([c], {});
    expect(row?.typeCounts).toEqual([]);
  });
});

describe("aggregateQuestionTypeCounts", () => {
  it("sums counts of the same type across multiple campaigns", () => {
    const rows = summarizeQuestionBank(
      [
        campaign({ id: "00000000-0000-4000-8000-000000000003", questionCount: 1 }),
        campaign({ id: "00000000-0000-4000-8000-000000000004", questionCount: 1 }),
      ],
      {
        "00000000-0000-4000-8000-000000000003": [
          trueFalseQuestion(
            "00000000-0000-4000-8000-000000000103",
            "00000000-0000-4000-8000-000000000003",
          ),
        ],
        "00000000-0000-4000-8000-000000000004": [
          trueFalseQuestion(
            "00000000-0000-4000-8000-000000000104",
            "00000000-0000-4000-8000-000000000004",
          ),
        ],
      },
    );

    expect(aggregateQuestionTypeCounts(rows)).toEqual([
      { type: "true_false", label: "True / false", count: 2 },
    ]);
  });
});

describe("summarizeRedemptionLedger", () => {
  it("counts and sums face value per status, and always labels rows 'measured'", () => {
    const vouchers = [
      voucher({ status: "redeemed", faceValueIdr: toIdrMinorUnits(50_000) }),
      voucher({ status: "redeemed", faceValueIdr: toIdrMinorUnits(30_000) }),
      voucher({ status: "active", faceValueIdr: toIdrMinorUnits(20_000) }),
    ];

    const summary = summarizeRedemptionLedger(vouchers);
    expect(summary.totalVoucherCount).toBe(3);

    const redeemedRow = summary.rows.find((row) => row.status === "redeemed");
    expect(redeemedRow?.count).toBe(2);
    expect(redeemedRow?.totalFaceValueIdr).toBe(80_000);
    expect(redeemedRow?.provenance).toBe("measured");

    const expiredRow = summary.rows.find((row) => row.status === "expired");
    expect(expiredRow?.count).toBe(0);
    expect(expiredRow?.totalFaceValueIdr).toBe(0);
  });

  it("never mixes statuses into one combined figure", () => {
    const summary = summarizeRedemptionLedger([
      voucher({ status: "redeemed" }),
      voucher({ status: "expired" }),
    ]);
    const statuses = summary.rows.map((row) => row.status);
    expect(new Set(statuses).size).toBe(statuses.length);
  });
});
