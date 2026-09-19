import { describe, expect, it } from "vitest";
import { INTEREST_OPTIONS } from "./interest-option";

describe("INTEREST_OPTIONS", () => {
  it("has a unique id, a non-empty label in both languages, and an icon for every option", () => {
    const ids = INTEREST_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const option of INTEREST_OPTIONS) {
      expect(option.labelEn.length).toBeGreaterThan(0);
      expect(option.labelId.length).toBeGreaterThan(0);
      expect(option.icon).toBeDefined();
    }
  });

  it("has enough options for a real choice, but few enough to stay a 15-second task", () => {
    // Real content, not lorem — but a 40-item grid would blow the
    // 15-second interest-picker budget (docs/tasks/phase-u-ui.md YT-0430).
    expect(INTEREST_OPTIONS.length).toBeGreaterThanOrEqual(8);
    expect(INTEREST_OPTIONS.length).toBeLessThanOrEqual(16);
  });
});
