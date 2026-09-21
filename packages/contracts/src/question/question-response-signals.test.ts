import { describe, expect, it } from "vitest";
import {
  HUMAN_JITTER_MS,
  MINIMUM_READ_MS,
  MIN_SAMPLES_FOR_JITTER,
  isMachineRegular,
  latencyJitterMs,
  readingTimeMs,
  timingSignals,
} from "./question-response-signals";

const SHORT_PROMPT = "Was it open?".length;
const LONG_PROMPT =
  "Which of the following best describes the opening hours the presenter mentioned for the Kemang branch on weekends?"
    .length;

describe("reading time", () => {
  it("scales with the prompt, so a long question buys more grace than a short one", () => {
    expect(readingTimeMs(LONG_PROMPT)).toBeGreaterThan(readingTimeMs(SHORT_PROMPT));
  });

  it("never drops below the floor, however short the prompt", () => {
    // Without this a three-word question computes a reading time near zero
    // and an instantaneous answer looks fine.
    expect(readingTimeMs(1)).toBe(MINIMUM_READ_MS);
    expect(readingTimeMs(0)).toBe(MINIMUM_READ_MS);
  });

  it("does not go negative on a nonsense length", () => {
    expect(readingTimeMs(-100)).toBe(MINIMUM_READ_MS);
  });

  /**
   * Deliberately a FAST reader, not an average one.
   *
   * This is the floor below which an answer cannot have been read at all,
   * so it must be the most generous plausible human. Set at average reading
   * speed it would flag quick readers, and a fraud signal that fires on
   * real people is one that gets switched off.
   */
  it("is generous enough that a quick reader is not a suspect", () => {
    // ~22 words at 400wpm is roughly 3.3s; a real reader who answers that
    // long prompt in 4 seconds must not be flagged.
    expect(timingSignals({ latencyMs: 4_000, promptLength: LONG_PROMPT, timerSeconds: 20 })).toEqual(
      [],
    );
  });
});

describe("one answer's timing", () => {
  const timing = (latencyMs: number, promptLength = SHORT_PROMPT, timerSeconds = 20) =>
    timingSignals({ latencyMs, promptLength, timerSeconds });

  it("says nothing about an ordinary answer", () => {
    expect(timing(3_000)).toEqual([]);
  });

  it("flags an answer that arrived before the prompt could be read", () => {
    const [signal] = timing(50);
    expect(signal?.kind).toBe("faster_than_reading");
  });

  it("flags an answer past its timer", () => {
    const [signal] = timing(25_000);
    expect(signal?.kind).toBe("beyond_timer");
  });

  it("reports a negative latency as a broken measurement, not as a fast viewer", () => {
    // Impossible from a server-measured interval. Recorded rather than
    // clamped, because a clamp hides the bug that produced it.
    const signals = timing(-5);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.kind).toBe("negative_latency");
  });

  it("is exclusive at the boundary, so exactly-at-reading-time is accepted", () => {
    const readingMs = readingTimeMs(SHORT_PROMPT);
    expect(timing(readingMs)).toEqual([]);
    expect(timing(readingMs - 1)[0]?.kind).toBe("faster_than_reading");
  });
});

describe("latency jitter", () => {
  it("refuses to judge too few answers", () => {
    // Two answers always have a spread and it means nothing. Reporting a
    // number here invites a threshold being applied to it.
    expect(latencyJitterMs([1_000, 1_200])).toBeNull();
    expect(latencyJitterMs(Array<number>(MIN_SAMPLES_FOR_JITTER - 1).fill(1_000))).toBeNull();
    expect(latencyJitterMs(Array<number>(MIN_SAMPLES_FOR_JITTER).fill(1_000))).not.toBeNull();
  });

  it("is zero for identical latencies", () => {
    expect(latencyJitterMs([2_000, 2_000, 2_000, 2_000])).toBe(0);
  });

  it("grows with spread", () => {
    const tight = latencyJitterMs([2_000, 2_050, 1_980, 2_010]) ?? 0;
    const loose = latencyJitterMs([900, 4_200, 2_600, 7_100]) ?? 0;
    expect(loose).toBeGreaterThan(tight);
  });
});

describe("machine regularity", () => {
  /**
   * The signal that survives an attacker who has read the timing check.
   *
   * Padding every answer past `readingTimeMs` is easy. Padding each one to
   * a *different* plausible delay, with human-shaped variance, is the part
   * nobody bothers with — so four identical 2,000ms answers pass every
   * per-answer check and are obviously machine-made when seen together.
   */
  it("catches a bot that padded every answer to the same plausible delay", () => {
    const padded = [2_000, 2_000, 2_000, 2_000, 2_000];

    // Each answer individually looks completely ordinary.
    for (const latencyMs of padded) {
      expect(timingSignals({ latencyMs, promptLength: SHORT_PROMPT, timerSeconds: 20 })).toEqual([]);
    }
    // Together they do not.
    expect(isMachineRegular(padded)).toBe(true);
  });

  it("leaves a real viewer alone", () => {
    expect(isMachineRegular([1_400, 3_900, 2_100, 6_800, 2_600])).toBe(false);
  });

  it("does not suspect a session too short to judge", () => {
    // An unknown is not a suspicion. Returning true on thin evidence is how
    // a risk rule starts suspending people who answered three questions.
    expect(isMachineRegular([2_000, 2_000])).toBe(false);
    expect(isMachineRegular([])).toBe(false);
  });

  it("tolerates jitter just under the human threshold", () => {
    // A bot adding a few milliseconds of noise is still a bot; a person is
    // never this consistent across five answers.
    const barelyNoisy = [2_000, 2_010, 1_995, 2_005, 2_000];
    expect(latencyJitterMs(barelyNoisy) ?? 0).toBeLessThan(HUMAN_JITTER_MS);
    expect(isMachineRegular(barelyNoisy)).toBe(true);
  });
});
