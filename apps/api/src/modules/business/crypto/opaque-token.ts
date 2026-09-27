import { createHash, randomBytes } from "node:crypto";

/**
 * A 256-bit CSPRNG token handed to the caller once, and its SHA-256 hex
 * digest stored in Postgres (business.team_invitations.token_hash) — "a
 * database read must not yield a usable credential", the same reasoning
 * `identity.session`/`identity.verification_token` apply.
 *
 * Deliberately a small, standalone copy of
 * `apps/api/src/modules/auth/crypto/opaque-token.ts` rather than an import
 * across it: `auth` is a different module's file, not a published port, and
 * this is ~10 lines of generic crypto with no domain coupling to duplicate
 * rather than reach across a module boundary for (docs/13b).
 */
export interface OpaqueToken {
  readonly token: string;
  readonly hash: string;
}

const TOKEN_BYTES = 32; // 256 bits.

export function issueOpaqueToken(): OpaqueToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
