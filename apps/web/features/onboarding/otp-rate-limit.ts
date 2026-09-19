/**
 * Pure, framework-free rolling-window rate limiting, shared by the resend
 * and verify-attempt limits in `phone-verification-reducer.ts`
 * (docs/tasks/phase-u-ui.md YT-0430: "rate-limited... must say when the user
 * may retry, not just refuse"). Kept independent of React and of the OTP
 * mock so it is trivially unit-testable and, later, trivially replaceable by
 * a real server-side limiter without touching any component.
 */
export interface RateLimitConfig {
  readonly maxAttempts: number;
  readonly windowMs: number;
}

export type RateLimitResult =
  { readonly limited: false } | { readonly limited: true; readonly retryAt: number };

/**
 * `attemptTimestamps` are the epoch-ms times of past attempts. Attempts
 * older than the window have already expired and do not count. Once the
 * window holds `maxAttempts` or more, the caller is limited until the
 * OLDEST attempt inside the window ages out — that instant is `retryAt`,
 * which is what lets the UI state the exact time retry becomes possible
 * instead of a vague "try again later".
 */
export function evaluateRateLimit(
  attemptTimestamps: readonly number[],
  now: number,
  config: RateLimitConfig,
): RateLimitResult {
  const windowStart = now - config.windowMs;
  const withinWindow = attemptTimestamps
    .filter((timestamp) => timestamp > windowStart)
    .sort((a, b) => a - b);

  if (withinWindow.length < config.maxAttempts) {
    return { limited: false };
  }

  const oldestInWindow = withinWindow[0];
  if (oldestInWindow === undefined) {
    return { limited: false };
  }
  return { limited: true, retryAt: oldestInWindow + config.windowMs };
}
