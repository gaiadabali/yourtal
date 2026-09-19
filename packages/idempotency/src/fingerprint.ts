import { createHash } from "node:crypto";

/**
 * The request fingerprint — what makes "same key, different request" a
 * detectable error rather than a silent wrong answer. YT-0039 AC1.
 *
 * `docs/12` §Idempotency: *"Store the request-param hash and reject
 * mismatches"*, and replaying a key with different params returns
 * `idempotency_error` / 409. Without this, a client that reuses a key by
 * accident — a loop variable that did not advance, a retry helper that
 * caches the header — gets the FIRST request's response for the SECOND
 * request's parameters. That is a wrong answer delivered with a 200, which
 * is the worst failure shape available: nothing logs, nothing alerts, and
 * the merchant is told a redemption succeeded that never happened.
 *
 * ## The canonical form is a wire contract, not an implementation detail
 *
 * This value is compared across processes and, eventually, across languages
 * — `docs/15` puts the ledger, pricing, voucher and redemption services in
 * Go, and they must compute byte-identical fingerprints for the same
 * request or a retry that lands on a Go instance will look like a mismatch.
 *
 * So the canonical string is specified here and must not be "improved":
 *
 *     METHOD \n path \n sha256(body)
 *
 * deliberately the same shape as the merchant HMAC canonical request in
 * `docs/14` §6, so there is one canonicalisation idea in the platform rather
 * than two that drift.
 *
 * ## Why the body is hashed rather than parsed
 *
 * Hashing the RAW BYTES avoids needing a canonical JSON form. Key order,
 * whitespace and number formatting all change the hash — which is stricter
 * than necessary but never WRONG, and the alternative (canonical JSON) is a
 * notorious source of cross-language disagreement. A client that re-serialises
 * its body differently between retries gets a 409 rather than a silent
 * mismatch, and 409 tells them exactly what to fix.
 */
export function requestFingerprint(method: string, path: string, rawBody: string): string {
  const bodyHash = sha256Hex(rawBody);
  return sha256Hex(`${method.toUpperCase()}\n${path}\n${bodyHash}`);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
