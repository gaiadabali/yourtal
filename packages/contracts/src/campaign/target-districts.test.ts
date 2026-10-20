import { describe, expect, it } from "vitest";
import { cleanTargetDistricts, districtTargetMatches } from "./target-districts";

describe("target districts (14.2)", () => {
  it("normalises spacing and drops blanks and case-insensitive duplicates", () => {
    expect(cleanTargetDistricts([" 2026 ", "2026", "", "0800"])).toEqual(["2026", "0800"]);
  });

  it("shows an untargeted campaign to every viewer, known district or not", () => {
    expect(districtTargetMatches([], null)).toBe(true);
    expect(districtTargetMatches([], "2026")).toBe(true);
  });

  it("shows a targeted campaign only in its districts", () => {
    expect(districtTargetMatches(["2026", "2000"], " 2000 ")).toBe(true);
    expect(districtTargetMatches(["2026"], "2022")).toBe(false);
  });

  it("matches the whole postcode, never a prefix, and keeps a leading zero", () => {
    expect(districtTargetMatches(["2026"], "202")).toBe(false);
    expect(districtTargetMatches(["202"], "2026")).toBe(false);
    expect(districtTargetMatches(["0800"], "800")).toBe(false);
    expect(districtTargetMatches(["0800"], "0800")).toBe(true);
  });

  it("never shows a targeted campaign to a viewer whose district is unknown", () => {
    expect(districtTargetMatches(["2026"], null)).toBe(false);
    expect(districtTargetMatches(["2026"], undefined)).toBe(false);
    expect(districtTargetMatches(["2026"], "   ")).toBe(false);
  });
});
