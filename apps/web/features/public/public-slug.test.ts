import { describe, expect, it } from "vitest";
import { slugify } from "./public-slug";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Kopi Kenangan")).toBe("kopi-kenangan");
  });

  it("strips diacritics", () => {
    expect(slugify("Kopi Senja Sétiabudi")).toBe("kopi-senja-setiabudi");
  });

  it("collapses punctuation into single hyphens and trims the ends", () => {
    expect(slugify("  Toko & Warung!!  ")).toBe("toko-warung");
  });

  it("is stable for names already in slug form", () => {
    expect(slugify("kopi-kenangan")).toBe("kopi-kenangan");
  });
});
