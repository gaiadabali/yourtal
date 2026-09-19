import { describe, expect, it } from "vitest";
import { describeQuestionCount, describeScoringRule } from "./campaign-scoring-copy";

describe("describeScoringRule", () => {
  it("describes base_only as unconditional", () => {
    expect(describeScoringRule("base_only")).toMatch(/tanpa syarat/);
  });

  it("describes base_plus_accuracy_bonus as base plus a bonus", () => {
    expect(describeScoringRule("base_plus_accuracy_bonus")).toMatch(/bonus/);
  });
});

describe("describeQuestionCount", () => {
  it("reads naturally at zero", () => {
    expect(describeQuestionCount(0)).toBe("Tidak ada pertanyaan");
  });

  it("reads naturally at one", () => {
    expect(describeQuestionCount(1)).toBe("1 pertanyaan");
  });

  it("reads naturally at many", () => {
    expect(describeQuestionCount(4)).toBe("4 pertanyaan");
  });
});
