import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs the worker -> api call to `POST /internal/studio/media/:assetId/ready`
 * (TASKS.md 7.2.b). Same shape as `ledger-internal/service-signature.ts`
 * (timestamp, caller, method, path+query, body digest, HMAC-SHA256) minus
 * the nonce: that call's replay defence is a server-side nonce cache the
 * ledger (a separate Go service) owns, and duplicating a cache here for one
 * loopback endpoint would be new infrastructure for a call this handler
 * already has to tolerate twice — 7.2.b's own ready callback is idempotent
 * by construction (it sets an asset to its final state; a repeat write is a
 * no-op), so a bounded timestamp window is the whole defence this needs.
 */
export const MEDIA_SERVICE_SIGNATURE_HEADER = "x-yourtal-media-signature";

/** How stale a signature may be before it is refused. */
export const MEDIA_SIGNATURE_WINDOW_SECONDS = 300;

export interface MediaServiceSignatureInput {
  readonly secret: string;
  readonly method: string;
  readonly pathAndQuery: string;
  readonly body: string;
  /** Seconds since the epoch; defaults to now. */
  readonly unixSeconds?: number;
}

export function signMediaServiceRequest(input: MediaServiceSignatureInput): string {
  const t = input.unixSeconds ?? Math.floor(Date.now() / 1000);
  const digest = createHash("sha256").update(input.body).digest("base64");
  const mac = createHmac("sha256", input.secret)
    .update([String(t), input.method.toUpperCase(), input.pathAndQuery, digest].join("\n"))
    .digest("hex");
  return `t=${String(t)},v1=${mac}`;
}

export type MediaServiceSignatureVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

export function verifyMediaServiceRequest(
  input: MediaServiceSignatureInput & { readonly header: string | undefined },
): MediaServiceSignatureVerdict {
  if (input.header === undefined) return { ok: false, reason: "malformed" };
  const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(input.header);
  if (!match) return { ok: false, reason: "malformed" };
  const tRaw = match[1];
  const presented = match[2];
  if (tRaw === undefined || presented === undefined) {
    return { ok: false, reason: "malformed" };
  }

  const expected = signMediaServiceRequest({ ...input, unixSeconds: Number(tRaw) });
  const expectedMac = expected.split("v1=")[1] ?? "";
  const presentedBytes = Buffer.from(presented, "hex");
  const expectedBytes = Buffer.from(expectedMac, "hex");
  if (
    presentedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(presentedBytes, expectedBytes)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const nowSeconds = input.unixSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(tRaw)) > MEDIA_SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}
