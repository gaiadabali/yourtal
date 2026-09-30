import { describe, expect, it } from "vitest";
import { timeLeftParts } from "./auction-time";

const now = Date.parse("2026-09-30T00:00:00.000Z");
const at = (ms: number) => new Date(now + ms).toISOString();

describe("time left on an auction", () => {
  it("counts down in days, hours and minutes, and says when it has ended", () => {
    expect(timeLeftParts(at(-1), now).key).toBe("ended");
    expect(timeLeftParts(at(30_000), now).key).toBe("underMinute");
    expect(timeLeftParts(at(45 * 60_000), now)).toStrictEqual({
      key: "minutes",
      values: { m: 45 },
    });
    expect(timeLeftParts(at(125 * 60_000), now)).toStrictEqual({
      key: "hours",
      values: { h: 2, m: 5 },
    });
    expect(timeLeftParts(at(50 * 3_600_000), now)).toStrictEqual({
      key: "days",
      values: { d: 2, h: 2 },
    });
  });
});
