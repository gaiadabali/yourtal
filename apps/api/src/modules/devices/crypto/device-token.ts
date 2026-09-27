import { createHash, randomBytes, randomInt } from "node:crypto";

/**
 * Two bearer secrets a counter device carries, both hashed the same way as
 * `apps/api/src/modules/business/crypto/opaque-token.ts` (sha256 hex
 * digest) — a database read must not yield a usable credential.
 * Deliberately its own tiny copy rather than an import across a module
 * boundary, same reasoning as that file's own comment.
 */
const SECRET_BYTES = 32; // 256 bits (TASKS.md 8.1.a).

export interface OpaqueSecret {
  readonly secret: string;
  readonly hash: string;
}

export function issueDeviceCredential(): OpaqueSecret {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { secret, hash: hashDeviceSecret(secret) };
}

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Crockford-ish, 10 characters, read aloud at a till — same alphabet as `me/linked-apps.controller.ts`. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function issuePairingCode(length = 10): OpaqueSecret {
  const code = Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(
    "",
  );
  return { secret: code, hash: hashDeviceSecret(code) };
}
