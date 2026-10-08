import { describe, expect, it } from "vitest";
import { getStudioTranslator } from "../studio-i18n";
import {
  computeMaxAskedQuestions,
  computeMinBankSize,
  describeBankSize,
  evaluateBankSize,
} from "./question-bank-rules";

const t = getStudioTranslator("en-AU");

describe("computeMaxAskedQuestions", () => {
  const table: Array<{ durationSeconds: number; expected: number }> = [
    { durationSeconds: 60, expected: 0 },
    { durationSeconds: 4 * 60, expected: 0 },
    { durationSeconds: 5 * 60, expected: 1 },
    { durationSeconds: 15 * 60, expected: 3 },
    { durationSeconds: 25 * 60, expected: 5 },
    { durationSeconds: 60 * 60, expected: 5 },
  ];

  it.each(table)(
    "caps a $durationSeconds-second video at $expected asked questions",
    ({ durationSeconds, expected }) => {
      expect(computeMaxAskedQuestions(durationSeconds)).toBe(expected);
    },
  );
});

describe("computeMinBankSize", () => {
  it("is 3x the asked count (the anti-sharing rule)", () => {
    expect(computeMinBankSize(1)).toBe(3);
    expect(computeMinBankSize(3)).toBe(9);
    expect(computeMinBankSize(5)).toBe(15);
    expect(computeMinBankSize(0)).toBe(0);
  });
});

describe("evaluateBankSize", () => {
  it("passes a video too short to ask any question at all, with an explanatory message", () => {
    const result = evaluateBankSize(60, 0);
    expect(result.meetsRequirement).toBe(true);
    expect(result.askedCount).toBe(0);
    expect(describeBankSize(result, t).length).toBeGreaterThan(0);
  });

  it("fails an under-sized bank and explains exactly how many more are needed", () => {
    const result = evaluateBankSize(15 * 60, 4); // asks 3, needs 9
    expect(result.askedCount).toBe(3);
    expect(result.requiredBankSize).toBe(9);
    expect(result.meetsRequirement).toBe(false);
    expect(describeBankSize(result, t)).toContain("Add 5 more");
    expect(describeBankSize(result, getStudioTranslator("id-ID"))).toContain("Tambahkan 5 lagi");
  });

  it("passes a bank exactly at the 3x minimum", () => {
    const result = evaluateBankSize(15 * 60, 9);
    expect(result.meetsRequirement).toBe(true);
  });

  it("passes a bank above the minimum", () => {
    const result = evaluateBankSize(15 * 60, 20);
    expect(result.meetsRequirement).toBe(true);
  });
});
