import { createHmac, timingSafeEqual } from "node:crypto";
import { type Result, err, ok } from "neverthrow";

/**
 * Webhook signature verification. YT-0537.
 *
 * ## Real crypto against a simulated sender
 *
 * The same rule the bot-check simulator follows: **the verify step is real
 * code even when the sender is simulated.** A simulator that returned
 * `{ valid: true }` would leave the call site untested — nothing would prove
 * the handler actually checks a signature, rejects a tampered body, or
 * refuses a stale one. So the simulator signs with a real HMAC and this
 * verifies it with a real HMAC, and the only thing that is fake is who is on
 * the other end.
 *
 * That matters more here than almost anywhere else. A webhook endpoint is
 * unauthenticated by definition — it is a public URL that anybody can POST
 * to — and the signature is the *only* thing distinguishing a payment
 * confirmation from a stranger claiming one. Shipping code whose signature
 * check has never rejected anything is shipping an endpoint that credits
 * points to whoever finds it.
 *
 * ## What is signed, and why all of it
 *
 * `timestamp.body`, not the body alone. Signing only the body makes every
 * captured request replayable forever: an attacker who sees one valid
 * `settled` callback can resend it whenever they like, and the signature
 * stays perfectly valid because nothing in it expires. Binding the timestamp
 * into the signed material means a replay has to forge the timestamp too,
 * which it cannot do without the secret.
 *
 * The timestamp alone is not enough either — it must be *inside* the
 * signature, not beside it. A timestamp sent as an unsigned header is one an
 * attacker simply rewrites.
 *
 * ## Constant-time comparison
 *
 * `timingSafeEqual`, not `===`. String comparison short-circuits on the
 * first differing byte, so the time it takes leaks how much of a guess was
 * correct, and an attacker can recover a signature byte by byte. This is the
 * textbook example and it is still worth writing down, because `===` looks
 * completely reasonable in review.
 *
 * ## Why this scheme, when Xendit's is different
 *
 * Xendit sends a **static `x-callback-token`** — the same value every time,
 * with no timestamp and no binding to the body. That is strictly weaker:
 * nothing expires, nothing ties the token to the payload it arrived with,
 * and a single leak is permanent. Stripe signs with HMAC and a timestamp,
 * which is the shape implemented here.
 *
 * The simulator deliberately implements the **stronger** scheme, so the
 * handler is written against a real signature check rather than a string
 * equality. A live Xendit driver implements `verifyWebhook` with whatever
 * that vendor actually requires, behind the same interface — which is the
 * whole point of the seam, and why the domain never learns which scheme it
 * is living with.
 */

export const SIGNATURE_HEADER = "x-yourtal-signature";
export const TIMESTAMP_HEADER = "x-yourtal-timestamp";

/** Five minutes, the window Stripe uses and a reasonable clock-skew allowance. */
export const REPLAY_TOLERANCE_MS = 5 * 60 * 1_000;

export type SignatureFailure =
  | { readonly kind: "missing_signature" }
  | { readonly kind: "missing_timestamp" }
  | { readonly kind: "malformed_timestamp"; readonly value: string }
  | { readonly kind: "stale_timestamp"; readonly ageMs: number }
  | { readonly kind: "future_timestamp"; readonly aheadMs: number }
  | { readonly kind: "bad_signature" };

/** What a sender puts on the wire. */
export function signWebhook(body: string, secret: string, timestampMs: number): string {
  return createHmac("sha256", secret)
    .update(`${String(timestampMs)}.${body}`)
    .digest("hex");
}

export interface VerifyInput {
  readonly body: string;
  readonly secret: string;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly nowMs: number;
}

export function verifyWebhookSignature(input: VerifyInput): Result<true, SignatureFailure> {
  if (input.signature === undefined || input.signature === "") {
    return err({ kind: "missing_signature" });
  }
  if (input.timestamp === undefined || input.timestamp === "") {
    return err({ kind: "missing_timestamp" });
  }

  const timestampMs = Number(input.timestamp);
  if (!Number.isInteger(timestampMs)) {
    return err({ kind: "malformed_timestamp", value: input.timestamp });
  }

  const ageMs = input.nowMs - timestampMs;
  if (ageMs > REPLAY_TOLERANCE_MS) {
    return err({ kind: "stale_timestamp", ageMs });
  }
  // A timestamp from the future is rejected too. Allowing it would let an
  // attacker mint a callback that stays valid for as long as they like,
  // which defeats the window entirely — the check has to be two-sided.
  if (-ageMs > REPLAY_TOLERANCE_MS) {
    return err({ kind: "future_timestamp", aheadMs: -ageMs });
  }

  const expected = signWebhook(input.body, input.secret, timestampMs);
  if (!constantTimeEquals(expected, input.signature)) {
    return err({ kind: "bad_signature" });
  }
  return ok(true);
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  // `timingSafeEqual` throws on a length mismatch, and the throw itself
  // leaks the length — so the lengths are compared first and deliberately,
  // rather than letting an exception do it. A signature's length is not
  // secret; its contents are.
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function describeSignatureFailure(failure: SignatureFailure): string {
  switch (failure.kind) {
    case "missing_signature":
      return `No ${SIGNATURE_HEADER} header. An unsigned webhook is an anonymous POST.`;
    case "missing_timestamp":
      return `No ${TIMESTAMP_HEADER} header. Without it a captured callback replays forever.`;
    case "malformed_timestamp":
      return `${TIMESTAMP_HEADER}="${failure.value}" is not a millisecond epoch.`;
    case "stale_timestamp":
      return `Callback is ${String(Math.round(failure.ageMs / 1_000))}s old, beyond the ${String(REPLAY_TOLERANCE_MS / 1_000)}s window.`;
    case "future_timestamp":
      return `Callback is dated ${String(Math.round(failure.aheadMs / 1_000))}s in the future.`;
    case "bad_signature":
      return "Signature does not match the body. Treat as hostile, not as a bug.";
  }
}
