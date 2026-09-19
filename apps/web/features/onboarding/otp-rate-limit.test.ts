import { describe, expect, it } from "vitest";
import { evaluateRateLimit } from "./otp-rate-limit";

const CONFIG = { maxAttempts: 3, windowMs: 60_000 };

describe("evaluateRateLimit", () => {
  it("is not limited with fewer attempts than the max, inside the window", () => {
    const result = evaluateRateLimit([1_000, 2_000], 3_000, CONFIG);
    expect(result.limited).toBe(false);
  });

  it("is limited once the window holds `maxAttempts` entries", () => {
    const result = evaluateRateLimit([1_000, 2_000, 3_000], 3_500, CONFIG);
    expect(result).toStrictEqual({ limited: true, retryAt: 1_000 + CONFIG.windowMs });
  });

  it("states retryAt as the moment the OLDEST attempt in the window expires, not `now`", () => {
    const result = evaluateRateLimit([10_000, 20_000, 30_000], 31_000, CONFIG);
    expect(result).toStrictEqual({ limited: true, retryAt: 10_000 + CONFIG.windowMs });
  });

  it("does not count attempts that have already aged out of the window", () => {
    // The first two attempts are outside a 60s window measured from now=200_000.
    const result = evaluateRateLimit([1_000, 2_000, 199_000], 200_000, CONFIG);
    expect(result.limited).toBe(false);
  });

  it("is not limited with zero attempts", () => {
    const result = evaluateRateLimit([], 0, CONFIG);
    expect(result.limited).toBe(false);
  });

  it("does not mutate the input array", () => {
    const attempts = [3_000, 1_000, 2_000];
    const original = [...attempts];
    evaluateRateLimit(attempts, 5_000, CONFIG);
    expect(attempts).toStrictEqual(original);
  });
});
