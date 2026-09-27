/**
 * Capped exponential backoff with full jitter, honouring a server's
 * `Retry-After` when it gives one. Generic over the attempted operation and
 * over what counts as retryable — `client.ts` supplies both, so this file
 * knows nothing about HTTP or the voucher API.
 */
export interface RetryOptions {
  /** Total attempts, including the first. Default 4 (one try, three retries). */
  maxAttempts?: number;
  /** Backoff before attempt 2, doubling (capped) each attempt after. Default 250ms. */
  baseDelayMs?: number;
  /** Never wait longer than this between attempts, `Retry-After` included. Default 8000ms. */
  maxDelayMs?: number;
  /** Test seam: replaces `setTimeout`-based waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam: replaces `Math.random` for deterministic jitter. */
  random?: () => number;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Parses `Retry-After` as either delta-seconds or an HTTP-date, per RFC 9110 §10.2.3. Returns `undefined` if absent or unparseable. */
export function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const asDate = Date.parse(headerValue);
  if (Number.isNaN(asDate)) return undefined;
  const deltaMs = asDate - Date.now();
  return deltaMs > 0 ? deltaMs : 0;
}

function backoffDelayMs(
  attemptNumber: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  // Full jitter (AWS's "Exponential Backoff And Jitter"): uniform over
  // [0, cap], not cap ± a small wobble — the wobble alone still lets every
  // client's retries cluster back together within a couple of rounds.
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attemptNumber - 1));
  return Math.floor(random() * cap);
}

export async function withRetry<T>(
  options: RetryOptions | undefined,
  isRetryable: (error: unknown) => boolean,
  /** Returns an explicit `Retry-After` delay for this error, if any (e.g. from a 429/503 response). */
  retryAfterMsFor: (error: unknown) => number | undefined,
  attempt: (attemptNumber: number) => Promise<T>,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 250;
  const maxDelayMs = options?.maxDelayMs ?? 8000;
  const sleep = options?.sleep ?? defaultSleep;
  const random = options?.random ?? Math.random;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      return await attempt(attemptNumber);
    } catch (error) {
      const isLastAttempt = attemptNumber === maxAttempts;
      if (isLastAttempt || !isRetryable(error)) throw error;
      const retryAfterMs = retryAfterMsFor(error);
      const delayMs =
        retryAfterMs !== undefined
          ? Math.min(retryAfterMs, maxDelayMs)
          : backoffDelayMs(attemptNumber, baseDelayMs, maxDelayMs, random);
      await sleep(delayMs);
    }
  }
  // Unreachable: the loop always returns or throws on its final iteration.
  throw new Error("withRetry: exhausted attempts without a result or a thrown error");
}
