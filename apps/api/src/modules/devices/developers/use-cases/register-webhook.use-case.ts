import type { ResultAsync } from "neverthrow";
import type { WebhookSubscription } from "@yourtal/contracts/merchant/merchant-developer-credential";
import type { WebhookSubscriptionRepository } from "../persistence/webhook-subscription.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { issueWebhookSecret, sealWebhookSecret } from "../crypto/webhook-secret";
import { wrapPersistence } from "../../wrap-persistence";

export interface RegisterWebhookResult extends WebhookSubscription {
  /** Shown once, at registration — never stored in the clear and never read back. */
  readonly secret: string;
}

/** TASKS.md 8.3.c: registers (or replaces) a business's webhook delivery URL and mints a fresh signing secret. */
export function registerWebhook(
  webhooks: WebhookSubscriptionRepository,
  encryptionKey: string,
  businessId: string,
  url: string,
): ResultAsync<RegisterWebhookResult, PersistenceFailedError> {
  const secret = issueWebhookSecret();
  const sealed = sealWebhookSecret(secret, encryptionKey);
  return wrapPersistence(webhooks.upsert(businessId, url, sealed)).map((row) => ({
    businessId: row.businessId,
    url: row.url,
    secretIssuedAt: row.createdAt.toISOString(),
    secret,
  }));
}
