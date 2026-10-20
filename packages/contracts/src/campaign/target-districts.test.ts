import { describe, expect, it } from "vitest";
import { cleanTargetDistricts, districtTargetMatches } from "./target-districts";

describe("target districts (14.2)", () => {
  it("normalises spacing and drops blanks and case-insensitive duplicates", () => {
    expect(cleanTargetDistricts(["  Kemang ", "kemang", "", "South   Jakarta"])).toEqual([
      "Kemang",
      "South Jakarta",
    ]);
  });

  it("shows an untargeted campaign to every viewer, known district or not", () => {
    expect(districtTargetMatches([], null)).toBe(true);
    expect(districtTargetMatches([], "Kemang")).toBe(true);
  });

  it("shows a targeted campaign only in its districts", () => {
    expect(districtTargetMatches(["Kemang", "Menteng"], "  menteng ")).toBe(true);
    expect(districtTargetMatches(["Kemang"], "Bondi")).toBe(false);
  });

  it("never shows a targeted campaign to a viewer whose district is unknown", () => {
    expect(districtTargetMatches(["Kemang"], null)).toBe(false);
    expect(districtTargetMatches(["Kemang"], undefined)).toBe(false);
    expect(districtTargetMatches(["Kemang"], "   ")).toBe(false);
  });
});
