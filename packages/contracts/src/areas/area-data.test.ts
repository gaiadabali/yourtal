import { describe, expect, it } from "vitest";
import {
  areaState,
  areaStates,
  isKnownPostcode,
  knownPostcodeCount,
  postcodeNames,
  postcodeStates,
} from "./area-data";
import { areaLabel, isPostcodeShape } from "./area-list";

describe("area lists (F116)", () => {
  it("covers every Australian state and territory with a four-digit postcode on every place", () => {
    expect(areaStates("AU").map((state) => state.code)).toEqual([
      "NSW",
      "VIC",
      "QLD",
      "SA",
      "WA",
      "TAS",
      "NT",
      "ACT",
      "OT",
    ]);
    for (const state of areaStates("AU")) {
      for (const place of state.places) {
        expect(isPostcodeShape("AU", place.postcode)).toBe(true);
        expect(place.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("lists every postcode ABS publishes, not a sample", () => {
    expect(knownPostcodeCount("AU")).toBeGreaterThan(2600);
    for (const postcode of ["0800", "2000", "2026", "3000", "4000", "5000", "6000", "7000"]) {
      expect(isKnownPostcode("AU", postcode)).toBe(true);
    }
  });

  it("finds a suburb by name and gives its postcode", () => {
    const nsw = areaState("AU", "NSW");
    expect(nsw?.places).toContainEqual({ name: "Bondi", postcode: "2026" });
    expect(nsw?.places).toContainEqual({ name: "Pyrmont", postcode: "2009" });
    expect(postcodeNames("AU", "2026")).toContain("Bondi");
    expect(postcodeStates("AU", "2026")).toEqual(["NSW"]);
  });

  it("groups places by name inside a state, A to Z", () => {
    const names = (areaState("AU", "TAS")?.places ?? []).map((place) => place.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en-AU")));
  });

  it("walls the lists by region: an Australian postcode is not an Indonesian one", () => {
    expect(isKnownPostcode("AU", "12110")).toBe(false);
    expect(isKnownPostcode("ID", "12110")).toBe(true);
    expect(isKnownPostcode("ID", "2026")).toBe(false);
    expect(isKnownPostcode("AU", "9999")).toBe(false);
  });

  it("keeps a small Indonesian demo list", () => {
    expect(knownPostcodeCount("ID")).toBeGreaterThan(10);
    expect(knownPostcodeCount("ID")).toBeLessThan(60);
    expect(areaStates("ID").every((state) => state.places.length > 0)).toBe(true);
  });

  it("checks a postcode's shape per region", () => {
    expect(isPostcodeShape("AU", "0800")).toBe(true);
    expect(isPostcodeShape("AU", "800")).toBe(false);
    expect(isPostcodeShape("AU", "20000")).toBe(false);
    expect(isPostcodeShape("ID", "10110")).toBe(true);
    expect(isPostcodeShape("ID", "2026")).toBe(false);
    expect(isPostcodeShape("AU", "20a6")).toBe(false);
  });

  it("labels a postcode with its first names and how many more", () => {
    const more = (count: number) => `and ${String(count)} more`;
    expect(areaLabel(["A", "B"], more)).toBe("A, B");
    expect(areaLabel(["A", "B", "C", "D", "E"], more)).toBe("A, B, C and 2 more");
  });
});
