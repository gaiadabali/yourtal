/**
 * Read directly from `process.env`, the same way `CHECKPOINT_TOKEN_SECRET`
 * is (watch.module.ts) rather than threaded through `AppConfig` — a secret
 * with no default is deliberately not part of that shared, widely-injected
 * object (see `env.schema.ts`'s own comment on `CHECKPOINT_TOKEN_SECRET`).
 * `env.schema.ts` already validates this at boot (min length, required), so
 * by the time any provider resolves, it exists.
 */
export const WEBHOOK_SECRET_ENCRYPTION_KEY = Symbol("WEBHOOK_SECRET_ENCRYPTION_KEY");

export function requireWebhookSecretEncryptionKey(): string {
  const key = process.env["WEBHOOK_SECRET_ENCRYPTION_KEY"];
  if (key === undefined) {
    throw new Error(
      "WEBHOOK_SECRET_ENCRYPTION_KEY is required. Webhook signing secrets are sealed with it, " +
        "and a default would be a key every reader of this repository holds.",
    );
  }
  return key;
}
