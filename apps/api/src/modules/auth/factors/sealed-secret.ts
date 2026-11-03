import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Seals an authenticator-app seed at rest. The same scheme as a business's
 * webhook secret (`devices/developers/crypto/webhook-secret.ts`): AES-256-GCM
 * under a key taken from the environment and hashed to 32 bytes, a fresh
 * 12-byte nonce, the tag appended. A seed has to be recoverable to check a
 * code, so it cannot be hashed like a password.
 *
 * Two additions: the owner's user id is bound in as associated data, so a
 * sealed seed copied onto another account's row does not open; and the
 * result is one self-describing string (`v1.<nonce>.<ciphertext>`), stored in
 * `identity.credential.secret_hash` the way an Argon2id string is.
 */
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const TAG_BYTES = 16;

function keyBytes(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

export function sealSecret(secret: string, key: string, owner: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const sealed = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${nonce.toString("base64url")}.${sealed.toString("base64url")}`;
}

/** Throws when the string is malformed, the key is wrong or the owner differs. */
export function openSecret(sealedValue: string, key: string, owner: string): string {
  const [version, nonceText, sealedText] = sealedValue.split(".");
  if (version !== VERSION || nonceText === undefined || sealedText === undefined) {
    throw new Error("sealed secret: unknown format");
  }
  const nonce = Buffer.from(nonceText, "base64url");
  const sealed = Buffer.from(sealedText, "base64url");
  const decipher = createDecipheriv(ALGORITHM, keyBytes(key), nonce);
  decipher.setAAD(Buffer.from(owner, "utf8"));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
