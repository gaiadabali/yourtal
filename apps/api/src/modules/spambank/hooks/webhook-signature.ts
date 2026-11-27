import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stalwart signs its webhook with HMAC-SHA256 over the raw body, in an `X-Signature` header (BUILD.md §5.4).
 * The exact encoding is U4 (not yet read off a live delivery), so every plausible one is accepted: hex,
 * base64 and base64url (padded or not), each with an optional `sha256=` prefix. They all encode the same 32
 * bytes of one HMAC, so accepting several is no weaker: a forger still needs the key.
 */
export function verifyStalwartSignature(
  secret: string,
  rawBody: Buffer | string,
  header: string | undefined,
): boolean {
  if (header === undefined || header === "" || secret === "") return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const value = header.trim().replace(/^sha256=/i, "");
  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(value)) candidates.push(Buffer.from(value, "hex"));
  if (/^[A-Za-z0-9+/]{43}=?$/.test(value)) candidates.push(Buffer.from(value, "base64"));
  if (/^[A-Za-z0-9_-]{43}=?$/.test(value)) candidates.push(Buffer.from(value, "base64url"));
  return candidates.some(
    (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
  );
}

/** The largest body the webhook reads (§5.4). */
export const WEBHOOK_MAX_BYTES = 64 * 1024;
