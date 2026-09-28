import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `packages/sdk-merchant` ships standalone to a third-party brand's own
 * server (`dependencies: {}` in its own `package.json` — no internal
 * workspace package is a real dependency of the published SDK), so this is
 * a small, deliberate duplicate of
 * `@yourtal/contracts/merchant/merchant-developer-credential`'s
 * `webhookSignatureHeaderSchema` regex rather than an import of it — same
 * "standalone copy, disclosed" convention `apps/worker/src/jobs/
 * webhook-delivery.ts`'s own `PostgresSimOutboxStore`/`openWebhookSecret`
 * comments already use for the same reason, crossing the same boundary.
 */
const SIGNATURE_HEADER_PATTERN = /^t=(\d+),v1=([0-9a-f]{64})$/u;

/**
 * Verifies a `voucher.captured` / `voucher.refunded` / `voucher.expired`
 * webhook delivery, matching `apps/worker/src/jobs/webhook-delivery.ts`'s
 * `signPayload` exactly:
 *
 *   t = floor(deliveredAt.getTime() / 1000)
 *   v1 = hex(HMAC-SHA256(secret, `${t}.${rawBody}`))
 *   header = `t=${t},v1=${v1}`
 *
 * Deliberately a different, simpler canonical string than `signing.ts`'s
 * outbound `X-YourTal-Signature` (newline-joined, keyed, method+path-aware)
 * — this is an inbound webhook, which has no method, path or key id to
 * bind, only a body a business's server reads once. Header shape matches
 * `@yourtal/contracts/merchant/merchant-developer-credential`'s own
 * `webhookSignatureHeaderSchema` (`/^t=\d+,v1=[0-9a-f]{64}$/`), reused here
 * rather than re-declared so the two can never drift apart.
 *
 * 8.2's driver is simulated-only (docs/23 red line 11: no real outbound
 * HTTP call ever leaves the worker) — on staging, a business inspects a
 * delivery through `platform.sim_outbox` rather than a real webhook
 * receiver. This file verifies the same way a real receiver eventually
 * would: `rawBody` is whatever bytes were signed, and `signatureHeader` is
 * wherever the caller's own transport carried the header value (today,
 * `WebhookDeliveryPayload.signatureHeader`, a JSON field, since there is no
 * real HTTP request to carry a real header on).
 */

export interface VerifyWebhookSignatureInput {
  /** The exact bytes that were signed — never a re-serialized object, since key order or whitespace would change the hash. */
  rawBody: string | Uint8Array;
  /** The `t=...,v1=...` header value delivered alongside `rawBody`. */
  signatureHeader: string;
  /** The business's own webhook signing secret, shown once at registration time. */
  secret: string | Uint8Array;
  /**
   * How far `t` may drift from `now` in either direction before the
   * delivery is refused as stale (or, in principle, replayed from a
   * captured header far in the future). Defaults to 5 minutes — the same
   * order of magnitude Stripe and most other webhook senders use, and
   * generous enough for real network/retry delay without leaving a stolen
   * header usable for long.
   */
  toleranceSeconds?: number;
  /** Injectable for tests; defaults to `new Date()`. */
  now?: Date;
}

/** Thrown by `verifyWebhookSignature` — never `MerchantApiError`, which is only for the OUTBOUND authorize/capture/void/refund calls. */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

interface ParsedHeader {
  timestamp: number;
  mac: string;
}

function parseHeader(header: string): ParsedHeader {
  const match = SIGNATURE_HEADER_PATTERN.exec(header);
  if (!match) {
    throw new WebhookSignatureError(
      `malformed webhook signature header (expected "t=<unix>,v1=<hex>"): ${header}`,
    );
  }
  const [, timestampText, mac] = match;
  return { timestamp: Number(timestampText), mac: mac ?? "" };
}

/**
 * Verifies a delivery's signature and freshness. Throws `WebhookSignatureError`
 * on any failure (bad format, wrong MAC, stale timestamp) — never returns
 * `false`, so a caller cannot accidentally ignore the result the way an
 * unchecked boolean invites.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): void {
  const { timestamp, mac } = parseHeader(input.signatureHeader);

  const now = input.now ?? new Date();
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const driftSeconds = Math.abs(nowSeconds - timestamp);
  if (driftSeconds > toleranceSeconds) {
    throw new WebhookSignatureError(
      `webhook timestamp is ${String(driftSeconds)}s outside the ${String(toleranceSeconds)}s tolerance window`,
    );
  }

  const expectedMac = createHmac("sha256", toBytes(input.secret))
    .update(`${String(timestamp)}.`)
    .update(toBytes(input.rawBody))
    .digest("hex");

  const expected = Buffer.from(expectedMac, "hex");
  const actual = Buffer.from(mac, "hex");
  // Both are always 32 bytes (the header regex already enforced 64 hex
  // chars), so this length check is defence in depth, not a real branch —
  // timingSafeEqual throws on mismatched lengths instead of comparing.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new WebhookSignatureError("webhook signature does not match");
  }
}

/**
 * Convenience wrapper for verifying against the SIMULATED driver's own
 * delivered shape (`{ event, data, signatureHeader }`, e.g. a row read back
 * from `platform.sim_outbox` on staging) rather than a raw body string a
 * real HTTP receiver would have. Reconstructs the exact `rawBody`
 * `signPayload` signed — `JSON.stringify({ event, data })`, computed
 * BEFORE `signatureHeader` was appended to the delivered payload, so this
 * must re-serialize only those two keys, in this order, not re-stringify
 * the whole delivered object.
 */
export interface SimulatedWebhookDelivery {
  event: string;
  data: Record<string, unknown>;
  signatureHeader: string;
}

export function verifySimulatedWebhookDelivery(
  delivery: SimulatedWebhookDelivery,
  secret: string | Uint8Array,
  options?: Pick<VerifyWebhookSignatureInput, "toleranceSeconds" | "now">,
): void {
  const rawBody = JSON.stringify({ event: delivery.event, data: delivery.data });
  verifyWebhookSignature({
    rawBody,
    signatureHeader: delivery.signatureHeader,
    secret,
    ...options,
  });
}
