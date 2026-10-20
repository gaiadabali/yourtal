import { createHmac, timingSafeEqual } from "node:crypto";
import { type Result, err, ok } from "neverthrow";
import { REPLAY_TOLERANCE_MS, type SignatureFailure } from "../webhook-signature";

/**
 * Stripe's webhook signature, as Stripe documents it: `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=...]`, where
 * each v1 is HMAC-SHA256(secret, "<t>.<raw body>"). Any matching v1 is accepted (Stripe sends several while a
 * secret is being rolled); the window is 300 s in both directions, stricter than Stripe's library, which only
 * refuses stale ones. Never throws, whatever the header holds.
 */

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

/** What Stripe (and the payment simulation) puts on the wire. For tests and senders. */
export function signStripePayload(
  rawBody: string,
  secret: string,
  timestampSeconds: number,
): string {
  const v1 = createHmac("sha256", secret)
    .update(`${String(timestampSeconds)}.${rawBody}`)
    .digest("hex");
  return `t=${String(timestampSeconds)},v1=${v1}`;
}

function parseHeader(header: string): { timestamp: string | undefined; v1: string[] } {
  let timestamp: string | undefined;
  const v1: string[] = [];
  for (const item of header.split(",")) {
    const at = item.indexOf("=");
    if (at <= 0) continue;
    const key = item.slice(0, at).trim();
    const value = item.slice(at + 1).trim();
    if (key === "t" && timestamp === undefined) timestamp = value;
    if (key === "v1" && value !== "") v1.push(value);
  }
  return { timestamp, v1 };
}

function constantTimeEquals(expected: string, candidate: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(candidate, "utf8");
  // A signature's length is not secret; checked first because timingSafeEqual throws on a mismatch.
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface StripeVerifyInput {
  readonly rawBody: string;
  readonly header: string | undefined;
  readonly secret: string;
  readonly nowMs: number;
}

export function verifyStripeSignature(input: StripeVerifyInput): Result<true, SignatureFailure> {
  if (input.header === undefined || input.header.trim() === "") {
    return err({ kind: "missing_signature" });
  }
  const { timestamp, v1 } = parseHeader(input.header);
  if (timestamp === undefined || timestamp === "") return err({ kind: "missing_timestamp" });
  if (!/^\d{1,12}$/.test(timestamp))
    return err({ kind: "malformed_timestamp", value: timestamp.slice(0, 32) });
  if (v1.length === 0) return err({ kind: "missing_signature" });

  const ageMs = input.nowMs - Number(timestamp) * 1_000;
  if (ageMs > REPLAY_TOLERANCE_MS) return err({ kind: "stale_timestamp", ageMs });
  if (-ageMs > REPLAY_TOLERANCE_MS) return err({ kind: "future_timestamp", aheadMs: -ageMs });

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest("hex");
  // Every entry is compared, so the time taken does not reveal which one matched.
  let matched = false;
  for (const candidate of v1) {
    if (constantTimeEquals(expected, candidate)) matched = true;
  }
  return matched ? ok(true) : err({ kind: "bad_signature" });
}
