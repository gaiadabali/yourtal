import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_EDGE_MARGIN_SECONDS,
  CHECKPOINT_TOKEN_TTL_MS,
  type CheckpointClaims,
  type CheckpointTokenFailure,
  type CheckpointVerdict,
  checkpointSchedule,
  issueCheckpointToken,
  newCheckpointNonce,
  verifyCheckpointToken,
} from "./watch-checkpoint-token";

const SECRET = "test-secret-not-a-real-one";
const SESSION = "7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_SESSION = "11111111-2222-4333-8444-555555555555";
const NOW = 1_764_000_000_000;

function claims(overrides: Partial<CheckpointClaims> = {}): CheckpointClaims {
  return {
    sessionId: SESSION,
    checkpointIndex: 0,
    nonce: newCheckpointNonce(),
    expiresAtMs: NOW + CHECKPOINT_TOKEN_TTL_MS,
    ...overrides,
  };
}

type VerifyOverrides = Partial<Parameters<typeof verifyCheckpointToken>[0]>;

function verify(token: string, overrides: VerifyOverrides = {}): CheckpointVerdict {
  return verifyCheckpointToken({
    token,
    secret: SECRET,
    sessionId: SESSION,
    checkpointIndex: 0,
    nowMs: NOW,
    ...overrides,
  });
}

function accepted(verdict: CheckpointVerdict): CheckpointClaims {
  if (!verdict.accepted) throw new Error(`expected acceptance, got ${verdict.reason.kind}`);
  return verdict.claims;
}

/**
 * Gaps between consecutive times.
 *
 * Written as a fold rather than an indexed loop because
 * `noUncheckedIndexedAccess` types `times[i]` as possibly undefined, and the
 * honest ways out of that are a non-null assertion — which is the assumption
 * the flag exists to stop — or this.
 */
function consecutiveGaps(values: readonly number[]): readonly number[] {
  const gaps: number[] = [];
  let previous: number | undefined;
  for (const value of values) {
    if (previous !== undefined) gaps.push(value - previous);
    previous = value;
  }
  return gaps;
}

function refused(verdict: CheckpointVerdict): CheckpointTokenFailure {
  if (verdict.accepted) throw new Error("expected a refusal, got acceptance");
  return verdict.reason;
}

describe("checkpoint token", () => {
  it("round-trips and returns the nonce the caller must burn", () => {
    const issued = claims();
    // The nonce comes back deliberately: a bare `true` would let a caller
    // forget that single-use lives outside this module.
    expect(accepted(verify(issueCheckpointToken(issued, SECRET))).nonce).toBe(issued.nonce);
  });

  it("refuses a token signed with a different secret", () => {
    const token = issueCheckpointToken(claims(), "a-different-secret");
    expect(refused(verify(token)).kind).toBe("bad_signature");
  });

  it("refuses a tampered payload even though the payload is readable", () => {
    // The attack this is really about: base64url is an encoding, not a seal.
    // Anybody can decode the claims, extend the expiry and re-encode. Only
    // the signature stops them.
    const token = issueCheckpointToken(claims(), SECRET);
    const separator = token.lastIndexOf(".");
    const decoded = JSON.parse(
      Buffer.from(token.slice(0, separator), "base64url").toString("utf8"),
    ) as CheckpointClaims;
    const forged = Buffer.from(
      JSON.stringify({ ...decoded, expiresAtMs: decoded.expiresAtMs + 86_400_000 }),
      "utf8",
    ).toString("base64url");

    expect(refused(verify(`${forged}.${token.slice(separator + 1)}`)).kind).toBe("bad_signature");
  });

  /**
   * The two branches of the constant-time comparison, exercised separately.
   *
   * A length mismatch short-circuits before `timingSafeEqual` is reached, so
   * a truncated signature proves only that branch. Flipping one character of
   * a correct signature keeps the length identical and is the only input
   * that proves the byte comparison itself discriminates — without it, an
   * implementation that compared lengths and returned `true` would pass
   * every other test in this file.
   */
  it("refuses a signature of the right length differing by one character", () => {
    const token = issueCheckpointToken(claims(), SECRET);
    const separator = token.lastIndexOf(".");
    const signature = token.slice(separator + 1);
    const flipped = (signature[0] === "a" ? "b" : "a") + signature.slice(1);

    expect(flipped).toHaveLength(signature.length);
    expect(flipped).not.toBe(signature);
    expect(refused(verify(`${token.slice(0, separator)}.${flipped}`)).kind).toBe("bad_signature");
  });

  it("refuses a truncated signature", () => {
    const token = issueCheckpointToken(claims(), SECRET);
    const separator = token.lastIndexOf(".");
    const truncated = token.slice(separator + 1).slice(0, -1);

    expect(refused(verify(`${token.slice(0, separator)}.${truncated}`)).kind).toBe("bad_signature");
  });

  it("refuses a token minted for another session", () => {
    const token = issueCheckpointToken(claims({ sessionId: OTHER_SESSION }), SECRET);
    expect(refused(verify(token)).kind).toBe("wrong_session");
  });

  it("refuses a valid token replayed at a different checkpoint", () => {
    // Without this, one legitimately-earned token answers every checkpoint
    // in the video — the signature would be valid at each of them.
    const token = issueCheckpointToken(claims({ checkpointIndex: 2 }), SECRET);
    expect(refused(verify(token, { checkpointIndex: 5 })).kind).toBe("wrong_checkpoint");
  });

  it("refuses an expired token, one millisecond past the boundary", () => {
    const token = issueCheckpointToken(claims({ expiresAtMs: NOW }), SECRET);

    expect(verify(token, { nowMs: NOW }).accepted).toBe(true);
    expect(refused(verify(token, { nowMs: NOW + 1 })).kind).toBe("expired");
  });

  it.each([["", "empty"], ["no-separator", "no separator"], [".sig", "empty payload"], ["payload.", "empty signature"]])(
    "refuses %s as malformed (%s)",
    (token) => {
      expect(refused(verify(token)).kind).toBe("malformed");
    },
  );

  /**
   * The gap this module documents rather than closes.
   *
   * A signature cannot express "once". This test exists so the absence is a
   * recorded, asserted fact rather than something a reader assumes is
   * handled — and so it fails loudly if anyone ever makes verification
   * stateful without moving this expectation somewhere it still holds.
   */
  it("verifies the same token twice — single-use is not a property of the signature", () => {
    const token = issueCheckpointToken(claims(), SECRET);

    expect(verify(token).accepted).toBe(true);
    expect(verify(token).accepted).toBe(true);
  });
});

describe("checkpoint schedule", () => {
  const schedule = (overrides: Partial<Parameters<typeof checkpointSchedule>[0]> = {}) =>
    checkpointSchedule({
      sessionId: SESSION,
      durationSeconds: 1_200,
      count: 4,
      secret: SECRET,
      ...overrides,
    });

  it("is deterministic, so a resumed session sees the same checkpoints", () => {
    expect(schedule()).toEqual(schedule());
  });

  it("is strictly increasing", () => {
    const times = schedule({ count: 8 });
    expect(times.length).toBeGreaterThan(1);
    for (const gap of consecutiveGaps(times)) {
      expect(gap).toBeGreaterThan(0);
    }
  });

  it("never places a checkpoint inside the edge margins", () => {
    for (const duration of [120, 300, 1_200, 3_600]) {
      for (const at of schedule({ durationSeconds: duration, count: 6 })) {
        expect(at).toBeGreaterThanOrEqual(CHECKPOINT_EDGE_MARGIN_SECONDS);
        expect(at).toBeLessThan(duration - CHECKPOINT_EDGE_MARGIN_SECONDS);
      }
    }
  });

  it("gives two sessions different checkpoints", () => {
    // Shared schedules are what YT-0125's leak detection assumes are
    // abnormal. If every viewer saw the same times, identical answer
    // patterns would be the norm and the signal would be worthless.
    expect(schedule({ sessionId: OTHER_SESSION })).not.toEqual(schedule());
  });

  it("is unguessable without the secret", () => {
    expect(schedule({ secret: "somebody-elses-guess" })).not.toEqual(schedule());
  });

  it("returns nothing for a video too short to hold a checkpoint", () => {
    expect(schedule({ durationSeconds: CHECKPOINT_EDGE_MARGIN_SECONDS * 2 })).toEqual([]);
    expect(schedule({ durationSeconds: 10 })).toEqual([]);
  });

  it("reduces the count rather than crowding a short video", () => {
    // 40s leaves 10 usable seconds, so 30 checkpoints cannot each get a
    // distinct whole second. Fewer real checkpoints beats thirty fake ones.
    const times = schedule({ durationSeconds: 40, count: 30 });
    expect(times.length).toBeLessThanOrEqual(10);
    expect(new Set(times).size).toBe(times.length);
  });

  it("spreads checkpoints across the timeline rather than clustering them", () => {
    // The reason for per-bucket draws. A uniform draw over the whole
    // duration can put three checkpoints in the same ten seconds and leave
    // the rest of the video unattended.
    const times = schedule({ durationSeconds: 1_200, count: 4 });
    expect(times).toHaveLength(4);
    for (const gap of consecutiveGaps(times)) {
      expect(gap).toBeGreaterThan(1_170 / 4 / 2);
    }
  });

  it("never needs its tail clamp — the clamp is defensive, not load-bearing", () => {
    // If this ever fails, the arithmetic changed and the clamp started
    // hiding it. Asserted so the guard cannot silently become the mechanism.
    for (const duration of [60, 121, 300, 999, 1_200, 3_601]) {
      for (const at of schedule({ durationSeconds: duration, count: 5 })) {
        expect(at).toBeLessThan(duration - CHECKPOINT_EDGE_MARGIN_SECONDS);
      }
    }
  });
});
