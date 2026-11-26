import { createHmac } from "node:crypto";

/**
 * How the service logs in to a Spambank mailbox (BUILD.md §4.3, B3). Nothing per user is stored: the
 * password is derived from one key, so the key unlocks every mailbox and lives only in the API and
 * worker environment (`SPAMBANK_CREDENTIAL_KEY`).
 *
 * Here, in the drivers package, because both the API (the proxy) and the worker (ingest, auto-reply)
 * log in, and two copies of a derivation are how one of them drifts.
 */

/**
 * U1 (BUILD.md §8): whether Stalwart's Basic/IMAP/SMTP login name is the full address or the local
 * part. Day 1 settles it; changing this one value is the whole change, because the derivation input
 * is the login string itself. The full address is what the app-password screen shows users too.
 */
export const LOGIN_FORM: "address" | "local" = "address";

/** The login name for a mailbox: `<local>@<domain>` unless U1 says otherwise. */
export function loginFor(localPart: string, domain: string): string {
  return LOGIN_FORM === "address" ? `${localPart}@${domain}` : localPart;
}

/** The mailbox's address, always the full form. */
export function addressFor(localPart: string, domain: string): string {
  return `${localPart}@${domain}`;
}

/**
 * `base64url(HMAC-SHA256(key, "stalwart-account:v1:" + login))`. The key is used as its own UTF-8
 * bytes, the way the operator wrote it: no decoding step to disagree about.
 */
export function derivePassword(credentialKey: string, login: string): string {
  if (credentialKey.length < 32) {
    throw new Error("The credential key must be at least 32 characters.");
  }
  return createHmac("sha256", credentialKey)
    .update(`stalwart-account:v1:${login}`)
    .digest("base64url");
}
