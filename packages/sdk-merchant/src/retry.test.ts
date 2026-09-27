import { describe, expect, it, vi } from "vitest";
import { parseRetryAfterMs, withRetry } from "./retry";

function noopSleep(): (ms: number) => Promise<void> {
  return vi.fn((_ms: number) => Promise.resolve());
}

describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    const attempt = vi.fn(() => Promise.resolve("ok"));
    const result = await withRetry(
      { sleep: noopSleep() },
      () => true,
      () => undefined,
      attempt,
    );
    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable error up to maxAttempts, then throws", async () => {
    const error = new Error("boom");
    const attempt = vi.fn(() => Promise.reject(error));
    await expect(
      withRetry(
        { maxAttempts: 3, sleep: noopSleep(), random: () => 0 },
        () => true,
        () => undefined,
        attempt,
      ),
    ).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable error", async () => {
    const error = new Error("not retryable");
    const attempt = vi.fn(() => Promise.reject(error));
    await expect(
      withRetry(
        { maxAttempts: 5, sleep: noopSleep() },
        () => false,
        () => undefined,
        attempt,
      ),
    ).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("succeeds on a later attempt after retryable failures", async () => {
    let calls = 0;
    const attempt = vi.fn(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(new Error("transient")) : Promise.resolve("recovered");
    });
    const result = await withRetry(
      { maxAttempts: 5, sleep: noopSleep(), random: () => 0.5 },
      () => true,
      () => undefined,
      attempt,
    );
    expect(result).toBe("recovered");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("caps backoff at maxDelayMs even with full jitter (random=1)", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const attempt = vi.fn(() => Promise.reject(new Error("always fails")));
    await expect(
      withRetry(
        { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 2000, sleep, random: () => 1 },
        () => true,
        () => undefined,
        attempt,
      ),
    ).rejects.toThrow("always fails");
    const delays = sleep.mock.calls.map((call) => call[0]);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });

  it("honours an explicit Retry-After delay over computed backoff", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    let calls = 0;
    const attempt = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("rate limited")) : Promise.resolve("ok");
    });
    await withRetry(
      { sleep, baseDelayMs: 9999, maxDelayMs: 99999 },
      () => true,
      () => 1234,
      attempt,
    );
    expect(sleep).toHaveBeenCalledWith(1234);
  });

  it("caps even an explicit Retry-After at maxDelayMs", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    let calls = 0;
    const attempt = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("rate limited")) : Promise.resolve("ok");
    });
    await withRetry(
      { sleep, maxDelayMs: 500 },
      () => true,
      () => 50_000,
      attempt,
    );
    expect(sleep).toHaveBeenCalledWith(500);
  });
});

describe("parseRetryAfterMs", () => {
  it("returns undefined for a missing header", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses an HTTP-date in the future as a positive delay", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const delay = parseRetryAfterMs(future);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(5500);
  });

  it("clamps a past HTTP-date to zero rather than a negative delay", () => {
    const past = new Date(Date.now() - 5000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });

  it("returns undefined for garbage", () => {
    expect(parseRetryAfterMs("not-a-value-at-all")).toBeUndefined();
  });
});
