import { describe, expect, it } from "vitest";
import { toRealSeconds, toVirtualSeconds } from "./time-remap";

describe("time-remap", () => {
  it("round-trips real -> virtual -> real", () => {
    const real = 42;
    const realDuration = 100;
    const campaignDuration = 900;
    const virtual = toVirtualSeconds(real, realDuration, campaignDuration);
    expect(toRealSeconds(virtual, realDuration, campaignDuration)).toBeCloseTo(real, 5);
  });

  it("maps the end of the real asset to the end of the campaign's advertised duration", () => {
    expect(toVirtualSeconds(100, 100, 900)).toBeCloseTo(900, 5);
  });

  it("returns 0 rather than dividing by zero when a duration is not yet known", () => {
    expect(toVirtualSeconds(5, 0, 900)).toBe(0);
    expect(toRealSeconds(5, 100, 0)).toBe(0);
  });
});
