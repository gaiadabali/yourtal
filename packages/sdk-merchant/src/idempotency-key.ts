import { randomUUID } from "node:crypto";

/**
 * One key per logical call (authorize/capture/void/refund), generated once
 * and reused on every retry of that same call — never regenerated mid-retry,
 * or a retried request would look like a brand-new one to the server's
 * idempotency table and the safety this header exists for is gone.
 */
export function generateIdempotencyKey(): string {
  return randomUUID();
}
