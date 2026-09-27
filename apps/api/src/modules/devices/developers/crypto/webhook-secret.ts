import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * A webhook's own signing secret has to be RECOVERABLE, not hashed —
 * `apps/worker`'s delivery job computes the same HMAC the business
 * verifies, which a one-way hash cannot do (unlike a device or session
 * credential, which is only ever compared, never used to sign something
 * WE send). AES-256-GCM under `WEBHOOK_SECRET_ENCRYPTION_KEY`, the plainest
 * reversible envelope available without building `services/voucher`'s own
 * keyring/KMS machinery in TypeScript for one new secret — a disclosed
 * simplification, not the full envelope-encryption-with-a-real-KMS this
 * would need in production.
 */
const ALGORITHM = "aes-256-gcm";

function keyBytes(key: string): Buffer {
  // Accepts any string of at least 32 chars (env.schema.ts's own check) —
  // hashed down to exactly 32 bytes, so the raw env var need not itself be
  // valid key material.
  return createHash("sha256").update(key, "utf8").digest();
}

export interface SealedWebhookSecret {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
}

export function sealWebhookSecret(secret: string, key: string): SealedWebhookSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBytes(key), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce };
}

export function openWebhookSecret(sealed: SealedWebhookSecret, key: string): string {
  const authTag = sealed.ciphertext.subarray(sealed.ciphertext.length - 16);
  const ciphertext = sealed.ciphertext.subarray(0, sealed.ciphertext.length - 16);
  const decipher = createDecipheriv(ALGORITHM, keyBytes(key), sealed.nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** A fresh 32-byte secret, shown to the business exactly once. */
export function issueWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}
