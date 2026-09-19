import { describe, expect, it } from "vitest";
import { hashStringToSeed } from "./mock-seed";

describe("hashStringToSeed", () => {
  it("is deterministic for the same input", () => {
    expect(hashStringToSeed("yt-campaign-42")).toBe(hashStringToSeed("yt-campaign-42"));
  });

  it("separates ids that differ by one character", () => {
    expect(hashStringToSeed("yt-campaign-42")).not.toBe(hashStringToSeed("yt-campaign-43"));
  });

  it("always returns a non-negative 32-bit integer usable as a seed", () => {
    for (const id of ["", "a", "yt-campaign-42", "a".repeat(500), "ünïcødé-id"]) {
      const seed = hashStringToSeed(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xff_ff_ff_ff);
    }
  });

  it("pins known values, so a refactor cannot silently reshuffle every synthesised campaign", () => {
    // If these change, every synthesised campaign changes with them — and the
    // player and checkpoint would disagree for any already-issued link.
    expect(hashStringToSeed("abc")).toBe(193_409_669);
    expect(hashStringToSeed("yt-campaign-42")).toBe(600_999_760);
  });
});
