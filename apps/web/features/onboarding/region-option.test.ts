import { describe, expect, it } from "vitest";
import { REGION_OPTIONS } from "./region-option";

describe("REGION_OPTIONS", () => {
  it("offers exactly Australia and Indonesia, per the founder's registration decision", () => {
    expect(REGION_OPTIONS.map((option) => option.region).sort()).toStrictEqual(["AU", "ID"]);
  });

  it("gives every option a non-empty bilingual tagline and a positive example amount", () => {
    for (const option of REGION_OPTIONS) {
      expect(option.taglineEn.length).toBeGreaterThan(0);
      expect(option.taglineId.length).toBeGreaterThan(0);
      expect(option.exampleAmountMinor).toBeGreaterThan(0);
    }
  });
});
