import { describe, expect, it } from "vitest";
import { formatDataCost, formatDuration } from "./campaign-format";

describe("formatDuration", () => {
  it("formats sub-minute durations in seconds (Quick campaigns)", () => {
    expect(formatDuration(45)).toBe("45 detik");
  });

  it("formats minute-scale durations rounded to the nearest minute", () => {
    expect(formatDuration(1_080)).toBe("18 menit");
  });

  it("formats hour-scale durations with a leading hour component", () => {
    expect(formatDuration(3_600)).toBe("1 jam");
    expect(formatDuration(5_400)).toBe("1 jam 30 menit");
  });
});

describe("formatDataCost", () => {
  it("shows one decimal place under 10 MB so small Quick campaigns are not rounded to 0", () => {
    expect(formatDataCost(2.1)).toBe("~2,1 MB");
  });

  it("rounds to the nearest whole MB at or above 10 MB and is always prefixed with a tilde", () => {
    expect(formatDataCost(210)).toBe("~210 MB");
  });

  it("never renders a bare number without the estimate tilde, per docs/06 §2.3", () => {
    expect(formatDataCost(90)).toMatch(/^~/);
  });
});
