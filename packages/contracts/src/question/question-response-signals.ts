/**
 * What a checkpoint answer reveals besides whether it was right. YT-0122.
 *
 * The answer itself is a weak signal — a guesser gets 25% of a four-option
 * question and a leaked key gets 100%, and neither looks different from
 * knowing. **How the answer arrived is the stronger signal**, and it is the
 * one an attacker has to work much harder to fake.
 *
 * ## Nothing here decides anything
 *
 * Every function returns a measurement or a list of observations. None of
 * them suspends an account, voids a checkpoint or scores a reward — `docs/18`
 * §11's rule is that a suspected account is suspended and reviewed, never
 * silently zeroed, and a module that could refuse on its own would make that
 * an implementation detail rather than a policy. Risk here is evidence for a
 * decision made elsewhere.
 *
 * ## Why latency is compared against reading time, not a constant
 *
 * "Under two seconds is suspicious" is wrong for a six-word prompt and
 * generous for a forty-word one. The floor scales with how long the prompt
 * takes to read, so a short question is allowed to be answered quickly —
 * otherwise the check punishes concise authoring and lets a bot through on
 * anything verbose.
 */

/** Words per minute a fast adult reader manages on unfamiliar text. */
export const FAST_READING_WPM = 400;

/**
 * Floor under any prompt's reading time.
 *
 * Even a three-word question needs a moment to see, register and reach for
 * an option. Without this, a very short prompt would compute a reading time
 * near zero and accept an instantaneous answer.
 */
export const MINIMUM_READ_MS = 700;

/** Below this, repeated latencies are too alike to have come from a person. */
export const HUMAN_JITTER_MS = 40;

/** Fewer answers than this cannot support a variance claim. */
export const MIN_SAMPLES_FOR_JITTER = 4;

export interface ResponseTiming {
  /** Server-measured, from question delivery to answer receipt. */
  readonly latencyMs: number;
  readonly promptLength: number;
  readonly timerSeconds: number;
}

export type ResponseSignal =
  | { readonly kind: "faster_than_reading"; readonly latencyMs: number; readonly readingMs: number }
  | { readonly kind: "beyond_timer"; readonly latencyMs: number; readonly timerMs: number }
  | { readonly kind: "negative_latency"; readonly latencyMs: number };

/**
 * How long the prompt plausibly takes to read, in milliseconds.
 *
 * Deliberately a FAST reader, not an average one. This is the floor below
 * which an answer could not have been read at all, so it has to be the most
 * generous plausible human — setting it at average reading speed would flag
 * quick readers as bots, and a fraud signal that fires on real people is one
 * that gets switched off.
 */
export function readingTimeMs(promptLength: number): number {
  const words = Math.max(promptLength, 0) / 5;
  const ms = (words / FAST_READING_WPM) * 60_000;
  return Math.max(Math.round(ms), MINIMUM_READ_MS);
}

/**
 * Everything observable about one answer's timing.
 *
 * Returns a list rather than a boolean: an answer can be both impossibly
 * fast and past its timer if a clock is wrong, and collapsing that to one
 * verdict would discard the fact that the two disagree — which is itself
 * the interesting observation.
 */
export function timingSignals(timing: ResponseTiming): readonly ResponseSignal[] {
  const signals: ResponseSignal[] = [];

  if (timing.latencyMs < 0) {
    // Cannot happen from a server-measured interval, so if it appears the
    // measurement is wrong or the value came from somewhere it should not
    // have. Recorded rather than clamped: a clamp would hide the bug.
    signals.push({ kind: "negative_latency", latencyMs: timing.latencyMs });
    return signals;
  }

  const readingMs = readingTimeMs(timing.promptLength);
  if (timing.latencyMs < readingMs) {
    signals.push({ kind: "faster_than_reading", latencyMs: timing.latencyMs, readingMs });
  }

  const timerMs = timing.timerSeconds * 1_000;
  if (timing.latencyMs > timerMs) {
    signals.push({ kind: "beyond_timer", latencyMs: timing.latencyMs, timerMs });
  }

  return signals;
}

/**
 * Spread of a session's answer latencies, in milliseconds.
 *
 * This is the "input entropy" half of the criterion, and it is the signal
 * that survives an attacker who has read the timing check. Padding every
 * answer to clear `readingTimeMs` is easy; padding it to a *different*
 * plausible delay each time, with human-shaped variance, is the part people
 * do not bother with. Four identical 2,000 ms answers pass every per-answer
 * check and are obviously machine-made together.
 *
 * Population standard deviation, not sample: this is the whole of what the
 * session did, not a sample drawn from a larger set.
 *
 * `null` below `MIN_SAMPLES_FOR_JITTER` — two answers always have a spread
 * and it means nothing, and reporting a number there invites a threshold
 * being applied to it.
 */
export function latencyJitterMs(latencies: readonly number[]): number | null {
  if (latencies.length < MIN_SAMPLES_FOR_JITTER) return null;

  const mean = latencies.reduce((total, value) => total + value, 0) / latencies.length;
  const variance =
    latencies.reduce((total, value) => total + (value - mean) ** 2, 0) / latencies.length;
  return Math.sqrt(variance);
}

/**
 * Whether a session's answers arrived too regularly to be hand-timed.
 *
 * `false` when there is not enough to judge — an unknown is not a
 * suspicion, and returning `true` on thin evidence is how a risk rule
 * starts suspending people who answered three questions.
 */
export function isMachineRegular(latencies: readonly number[]): boolean {
  const jitter = latencyJitterMs(latencies);
  return jitter !== null && jitter < HUMAN_JITTER_MS;
}

export function describeResponseSignal(signal: ResponseSignal): string {
  switch (signal.kind) {
    case "faster_than_reading":
      return `Answered in ${String(signal.latencyMs)}ms; the prompt takes at least ${String(signal.readingMs)}ms to read.`;
    case "beyond_timer":
      return `Answered after ${String(signal.latencyMs)}ms, past the ${String(signal.timerMs)}ms timer.`;
    case "negative_latency":
      return `Latency of ${String(signal.latencyMs)}ms is impossible from a server-measured interval — suspect the measurement, not the viewer.`;
  }
}
