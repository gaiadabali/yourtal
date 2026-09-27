export interface WebhookSubscriptionRow {
  readonly businessId: string;
  readonly url: string;
  readonly secretCiphertext: Buffer;
  readonly secretNonce: Buffer;
  readonly createdAt: Date;
}

export interface WebhookSubscriptionRepository {
  /** One subscription per business — a re-register replaces the URL and mints a new secret. */
  upsert(
    businessId: string,
    url: string,
    sealed: { readonly ciphertext: Buffer; readonly nonce: Buffer },
  ): Promise<WebhookSubscriptionRow>;
  findByBusinessId(businessId: string): Promise<WebhookSubscriptionRow | null>;
}

export const WEBHOOK_SUBSCRIPTION_REPOSITORY = Symbol("WEBHOOK_SUBSCRIPTION_REPOSITORY");
