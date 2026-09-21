import { createHash, randomBytes } from "node:crypto";

/**
 * The one shape every bearer token this module issues shares: a 256-bit
 * CSPRNG value handed to the caller, and its SHA-256 hex digest stored in
 * Postgres. YT-0540 — "a database read must not yield a usable credential",
 * the same reasoning `services/voucher/internal/redeem/redeem.go` already
 * applies to voucher codes (`crypto/sha256` over the canonical code, hex
 * digest looked up by `FindVoucherByCodeHash`).
 *
 * A single SHA-256 pass, not a slow KDF like Argon2id: the input here is
 * 256 bits of CSPRNG output, not a human-chosen password. Argon2id earns
 * its cost defending a LOW-entropy secret against offline guessing; there
 * is nothing to guess about a value nobody could have produced except by
 * reading it off the wire or out of the database, so a fast, unkeyed hash
 * loses nothing and keeps every session/token lookup a single cheap
 * comparison rather than a deliberately expensive one repeated on every
 * authenticated request.
 *
 * `base64url` for the token handed to the caller (URL- and header-safe,
 * unlike plain base64's `+`/`/`); hex for the digest stored and compared,
 * matching the voucher convention above.
 */
export interface OpaqueToken {
  /** Handed to the caller once. Never stored anywhere, including in a log. */
  readonly token: string;
  /** What actually lives in the database. */
  readonly hash: string;
}

const TOKEN_BYTES = 32; // 256 bits.

export function issueOpaqueToken(): OpaqueToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashOpaqueToken(token) };
}

/** The same digest a lookup recomputes from a caller-presented token. */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
