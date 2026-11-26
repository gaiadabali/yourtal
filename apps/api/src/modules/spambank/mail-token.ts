import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  MAIL_TOKEN_PREFIX,
  MAIL_TOKEN_TTL_SECONDS,
  mailTokenPayloadSchema,
} from "@yourtal/contracts/spambank/common";
import type { MailTokenPayload, SpambankApp } from "@yourtal/contracts/spambank/common";

/**
 * The 30-minute mail token (spambank/BUILD.md §4.3): `sbm1.<base64url(JSON)>.<base64url(HMAC)>`,
 * the HMAC-SHA256 over the first two parts. It names one mailbox and one person; the proxy then
 * calls Stalwart *as that mailbox*, so a token can never reach another mailbox's mail.
 *
 * The token is a bearer credential held by a browser or a phone: short-lived, signed with a key that
 * is not the credential key, and never able to create an app password (that needs a session).
 */

/** The key is used as the operator wrote it (UTF-8), like the credential key. */
const KEY_MIN = 32;
/** A token is a few hundred bytes; anything much longer is not one. */
const TOKEN_MAX = 1024;
const SIGNATURE_LENGTH = 43; // base64url of 32 bytes, unpadded

export interface MintMailToken {
  readonly mailboxId: string;
  readonly userId: string;
  readonly app: SpambankApp;
  readonly ttlSeconds?: number;
  /** Unix milliseconds; for tests. */
  readonly now?: number;
}

export interface MintedMailToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export type MailTokenFailure = "malformed" | "bad_signature" | "expired";

export type VerifiedMailToken =
  | { readonly ok: true; readonly payload: MailTokenPayload }
  | { readonly ok: false; readonly reason: MailTokenFailure };

function sign(key: string, signingInput: string): string {
  return createHmac("sha256", key).update(signingInput).digest("base64url");
}

function requireKey(key: string): void {
  if (key.length < KEY_MIN) {
    throw new Error(`The mail token key must be at least ${String(KEY_MIN)} characters.`);
  }
}

export function signMailToken(input: MintMailToken, key: string): MintedMailToken {
  requireKey(key);
  const ttl = input.ttlSeconds ?? MAIL_TOKEN_TTL_SECONDS;
  const exp = Math.floor((input.now ?? Date.now()) / 1000) + ttl;
  const payload: MailTokenPayload = {
    v: 1,
    m: input.mailboxId,
    u: input.userId,
    a: input.app,
    exp,
    n: randomBytes(16).toString("base64url"),
  };
  const signingInput = `${MAIL_TOKEN_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return {
    token: `${signingInput}.${sign(key, signingInput)}`,
    expiresAt: new Date(exp * 1000),
  };
}

/**
 * Checks the shape, the signature (constant time) and then the payload and the clock, in that order,
 * so nothing an attacker wrote is parsed before the signature is known good. The caller still has to
 * confirm the mailbox row is `active`.
 */
export function verifyMailToken(
  token: string,
  key: string,
  now: number = Date.now(),
): VerifiedMailToken {
  requireKey(key);
  if (token.length > TOKEN_MAX) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  const [prefix, body, signature] = parts;
  if (
    parts.length !== 3 ||
    prefix !== MAIL_TOKEN_PREFIX ||
    body === undefined ||
    body === "" ||
    signature?.length !== SIGNATURE_LENGTH
  ) {
    return { ok: false, reason: "malformed" };
  }
  const expected = Buffer.from(sign(key, `${prefix}.${body}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const parsed = mailTokenPayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  if (parsed.data.exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload: parsed.data };
}
