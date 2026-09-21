import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Checkpoint tokens. YT-0121.
 *
 * A checkpoint is the moment we ask a viewer a question to show a person is
 * present. The token is what proves the question was *served by us, for this
 * session, at a checkpoint we chose* — rather than conjured by a client that
 * would like to answer one.
 *
 * ## This module cannot make a token single-use, and says so
 *
 * Everything here is pure: signing, verification, expiry, and the schedule.
 * **Single-use is not a property a signature can have.** A valid signature
 * stays valid for as long as it has not expired, so the same token verifies
 * perfectly the second time it is presented. The only thing that makes it
 * single-use is a record, somewhere, that its nonce has been spent — and
 * that record has to be written atomically, or two concurrent presentations
 * both find it absent and both succeed.
 *
 * So this module issues the nonce and binds it into the signature, and a
 * nonce store burns it. A caller that verifies without burning has a
 * replayable token and a test suite that passes. That is why
 * `verifyCheckpointToken` returns the claims rather than a bare `true`: the
 * burn needs the nonce, and a signature check that returned `true` would let
 * a caller forget the second half exists.
 *
 * ## Why the timestamps are ours, and why they are random
 *
 * `docs/06` wants checkpoints unpredictable. A schedule the client can
 * compute is a schedule it can prepare for: a bot that knows the question
 * lands at 04:10 need only be present at 04:10. So the times come from a
 * PRF keyed by a server secret — deterministic for a given session, so
 * nothing has to be stored and a resumed session sees the same checkpoints,
 * and unguessable to anybody without the key.
 *
 * Per **session**, not per campaign. A schedule shared across viewers leaks
 * the moment any one of them describes it, and the answer-key leak work
 * (YT-0125) is built on two accounts seeing identical checkpoints being a
 * signal rather than the norm.
 *
 * ## Domain separation
 *
 * The schedule PRF and the token signature use one secret through different
 * prefixes (`TOKEN_DOMAIN`, `SCHEDULE_DOMAIN`). Without that, anything able
 * to request a schedule for a chosen session id could obtain HMACs of chosen
 * input under the token key, which is a signing oracle. The prefixes cost
 * nothing and close it.
 */

/**
 * How long a token is good for once issued.
 *
 * Short deliberately. The token's window is the window in which a stolen one
 * is worth stealing, and a checkpoint is answered by somebody already
 * watching — they do not need two minutes to notice it. Long enough to
 * survive a slow network and a viewer who glances away; not long enough to
 * be worth relaying to somebody else.
 */
export const CHECKPOINT_TOKEN_TTL_MS = 90_000;

/**
 * Checkpoints are never placed within this many seconds of the start or the
 * end of a video.
 *
 * At the start because a checkpoint at second 2 tests nothing — everybody is
 * present at second 2. At the end because one inside the final moments
 * cannot be answered before the video finishes, so a viewer who genuinely
 * watched it all would fail through no fault of their own.
 */
export const CHECKPOINT_EDGE_MARGIN_SECONDS = 15;

const TOKEN_DOMAIN = "yt:checkpoint:token:v1";
const SCHEDULE_DOMAIN = "yt:checkpoint:schedule:v1";

/** Bytes of randomness in a nonce. 16 is 128 bits; guessing one is not an attack. */
const NONCE_BYTES = 16;

export interface CheckpointClaims {
  /** The watch session this token belongs to. A token is useless on another. */
  readonly sessionId: string;
  /** Which checkpoint in this session's schedule, 0-based. */
  readonly checkpointIndex: number;
  /** The single-use value. Meaningless until something burns it. */
  readonly nonce: string;
  /** Absolute expiry, ms epoch. Inside the signature, never beside it. */
  readonly expiresAtMs: number;
}

export type CheckpointTokenFailure =
  | { readonly kind: "malformed" }
  | { readonly kind: "bad_signature" }
  | { readonly kind: "expired"; readonly ageMs: number }
  | { readonly kind: "wrong_session"; readonly signedFor: string }
  | { readonly kind: "wrong_checkpoint"; readonly signedFor: number };

/**
 * The outcome of presenting a token.
 *
 * A refusal is a value rather than an exception for the same reason
 * `judgeProgressReport` returns one: a refused checkpoint is ordinary
 * traffic — an expired tab, a double-tap, somebody probing — and an endpoint
 * that throws on ordinary traffic acquires a catch block that swallows real
 * errors along with it.
 */
export type CheckpointVerdict =
  | { readonly accepted: true; readonly claims: CheckpointClaims }
  | { readonly accepted: false; readonly reason: CheckpointTokenFailure };

/** Mints a nonce. Separate from signing so a caller cannot quietly reuse one. */
export function newCheckpointNonce(): string {
  return randomBytes(NONCE_BYTES).toString("hex");
}

function sign(domain: string, material: string, secret: string): string {
  return createHmac("sha256", secret).update(`${domain}.${material}`).digest("hex");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  // Length first and deliberately: `timingSafeEqual` throws on a mismatch
  // and the throw itself leaks the length. Same reasoning, and the same
  // shape, as `packages/drivers/src/boundaries/webhook-signature.ts`.
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

/** `<base64url(claims)>.<hmac>`. */
export function issueCheckpointToken(claims: CheckpointClaims, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${sign(TOKEN_DOMAIN, encoded, secret)}`;
}

export interface VerifyCheckpointInput {
  readonly token: string;
  readonly secret: string;
  /** The session presenting the token. Checked against the claims, not trusted. */
  readonly sessionId: string;
  readonly checkpointIndex: number;
  readonly nowMs: number;
}

/**
 * Verifies a token and returns its claims — **including the nonce, which the
 * caller must still burn.** See this module's header.
 */
export function verifyCheckpointToken(
  input: VerifyCheckpointInput,
): CheckpointVerdict {
  const separator = input.token.lastIndexOf(".");
  if (separator <= 0 || separator === input.token.length - 1) {
    return { accepted: false, reason: { kind: "malformed" } };
  }
  const encoded = input.token.slice(0, separator);
  const signature = input.token.slice(separator + 1);

  // Authenticate BEFORE decoding. Parsing attacker-controlled JSON to decide
  // whether to trust it is backwards: the parser is the first thing their
  // input reaches, and everything after it is running on their bytes.
  if (!constantTimeEquals(sign(TOKEN_DOMAIN, encoded, input.secret), signature)) {
    return { accepted: false, reason: { kind: "bad_signature" } };
  }

  const claims = decodeClaims(encoded);
  if (claims === null) {
    // Signed by us and still unreadable: not an attack, a bug or a format
    // change. Refused all the same — a token we cannot read is one we
    // cannot check.
    return { accepted: false, reason: { kind: "malformed" } };
  }

  // Session and checkpoint before expiry, so a stale token presented on the
  // wrong session reports the more serious of the two problems.
  if (claims.sessionId !== input.sessionId) {
    return { accepted: false, reason: { kind: "wrong_session", signedFor: claims.sessionId } };
  }
  if (claims.checkpointIndex !== input.checkpointIndex) {
    return { accepted: false, reason: { kind: "wrong_checkpoint", signedFor: claims.checkpointIndex } };
  }
  if (input.nowMs > claims.expiresAtMs) {
    return { accepted: false, reason: { kind: "expired", ageMs: input.nowMs - claims.expiresAtMs } };
  }
  return { accepted: true, claims };
}

function decodeClaims(encoded: string): CheckpointClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.sessionId !== "string" ||
    typeof candidate.nonce !== "string" ||
    typeof candidate.checkpointIndex !== "number" ||
    typeof candidate.expiresAtMs !== "number" ||
    !Number.isInteger(candidate.checkpointIndex) ||
    !Number.isInteger(candidate.expiresAtMs)
  ) {
    return null;
  }
  return {
    sessionId: candidate.sessionId,
    checkpointIndex: candidate.checkpointIndex,
    nonce: candidate.nonce,
    expiresAtMs: candidate.expiresAtMs,
  };
}

export interface CheckpointScheduleInput {
  readonly sessionId: string;
  /** Whole seconds, as everything in `watch` is (YT-0120). */
  readonly durationSeconds: number;
  readonly count: number;
  readonly secret: string;
}

/**
 * The checkpoint times for one session, in whole seconds, strictly
 * increasing.
 *
 * Deterministic: the same session always gets the same schedule, so a
 * resumed session does not silently acquire new checkpoints and nothing has
 * to be stored. Unguessable without the secret, which is the point.
 *
 * One checkpoint per equal bucket, randomised *within* its bucket rather
 * than across the whole video. Drawing uniformly over the duration would let
 * three checkpoints land in the same ten seconds and leave most of the video
 * unattended — the property wanted is coverage of the timeline, not
 * uniformity of each individual draw.
 *
 * Returns fewer checkpoints than asked for, or none at all, when the video
 * is too short to hold them outside the edge margins. Refusing to place a
 * checkpoint is better than placing one an honest viewer cannot answer.
 */
export function checkpointSchedule(input: CheckpointScheduleInput): readonly number[] {
  const first = CHECKPOINT_EDGE_MARGIN_SECONDS;
  const last = input.durationSeconds - CHECKPOINT_EDGE_MARGIN_SECONDS;
  const usable = last - first;
  if (input.count <= 0 || usable <= 0) return [];

  // One bucket per checkpoint. A bucket narrower than a second cannot hold a
  // distinct whole-second time, so the count comes down until it can.
  const count = Math.min(input.count, Math.floor(usable));
  if (count <= 0) return [];
  const bucket = usable / count;

  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const digest = sign(SCHEDULE_DOMAIN, `${input.sessionId}:${String(index)}`, input.secret);
    // 13 hex characters stays inside Number.MAX_SAFE_INTEGER, so the modulus
    // runs over a real integer rather than a rounded float.
    const draw = Number.parseInt(digest.slice(0, 13), 16);
    const span = Math.max(1, Math.floor(bucket));
    const at = Math.floor(first + index * bucket) + (draw % span);
    // Clamp rather than trust the arithmetic. A rounding error that pushed a
    // checkpoint past `last` would fail an honest viewer, and the guard is
    // cheaper than the proof that it cannot happen.
    times.push(Math.min(at, last - 1));
  }
  return times;
}

export function describeCheckpointFailure(failure: CheckpointTokenFailure): string {
  switch (failure.kind) {
    case "malformed":
      return "That is not a checkpoint token.";
    case "bad_signature":
      return "That checkpoint token was not issued by us. Treat as hostile, not as a bug.";
    case "expired":
      return `That checkpoint expired ${String(Math.round(failure.ageMs / 1_000))}s ago.`;
    case "wrong_session":
      return "That checkpoint token belongs to a different watch session.";
    case "wrong_checkpoint":
      return "That checkpoint token is for a different checkpoint in this session.";
  }
}
