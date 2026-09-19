import { describe, expect, it } from "vitest";
import { formatClock } from "./format-clock";

describe("formatClock", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(599)).toBe("9:59");
  });

  it("formats durations past an hour as h:mm:ss", () => {
    expect(formatClock(3_661)).toBe("1:01:01");
  });

  it("clamps non-finite or negative input to 0 rather than throwing or showing garbage", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
