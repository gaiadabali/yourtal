import { describe, expect, it } from "vitest";
import { areaLetter, areaSummaryLabel } from "./area-label";

const more = (count: number) => `and ${String(count)} more`;

describe("area labels", () => {
  it("spells out a postcode's suburbs, then how many more", () => {
    expect(areaSummaryLabel({ postcode: "2026", names: ["Bondi"], moreCount: 0 }, more)).toBe(
      "Bondi",
    );
    expect(areaSummaryLabel({ postcode: "2026", names: ["A", "B", "C"], moreCount: 4 }, more)).toBe(
      "A, B, C and 4 more",
    );
  });

  it("falls back to the postcode when no suburb is known", () => {
    expect(areaSummaryLabel({ postcode: "2026", names: [], moreCount: 0 }, more)).toBe("2026");
  });

  it("files a suburb under its first letter, accents and odd starts included", () => {
    expect(areaLetter("Bondi")).toBe("B");
    expect(areaLetter("Ému Plains")).toBe("E");
    expect(areaLetter("(Odd)")).toBe("#");
  });
});
