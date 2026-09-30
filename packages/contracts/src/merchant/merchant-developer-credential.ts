import * as z from "zod";

/**
 * TASKS.md 8.3.a: Studio -> Developers. Wraps the voucher service's own
 * merchant HMAC credential (`@yourtal/contracts/voucher-internal/credentials`)
 * one-to-one; this is the client-safe shape (no internal service-auth
 * concerns), with a `sandbox` flag Studio uses to label the one credential
 * every business gets for free at KYB.
 */

export const merchantCredentialStateSchema = z.enum(["active", "revoked"]);
export type MerchantCredentialState = z.infer<typeof merchantCredentialStateSchema>;

export const merchantDeveloperCredentialSchema = z.object({
  credentialId: z.string().min(1),
  label: z.string().min(1),
  sandbox: z.boolean(),
  state: merchantCredentialStateSchema,
  /** Only ever present in the response to issue/rotate — never on a later read. */
  secret: z.string().min(1).optional(),
  issuedAt: z.iso.datetime(),
});
export type MerchantDeveloperCredential = z.infer<typeof merchantDeveloperCredentialSchema>;

/** `POST /api/:tenantId/studio/developers/credentials` */
export const issueDeveloperCredentialRequestSchema = z.object({
  label: z.string().min(1).max(80),
  sandbox: z.boolean().default(true),
});
export type IssueDeveloperCredentialRequest = z.infer<typeof issueDeveloperCredentialRequestSchema>;

/** `POST /api/:tenantId/studio/developers/credentials/:credentialId/rotate` */
export const rotateDeveloperCredentialResultSchema = merchantDeveloperCredentialSchema;
export type RotateDeveloperCredentialResult = MerchantDeveloperCredential;

/** `POST /api/:tenantId/studio/developers/webhooks` — register the delivery URL (8.3.c). */
export const registerWebhookRequestSchema = z.object({
  url: z.url(),
});
export type RegisterWebhookRequest = z.infer<typeof registerWebhookRequestSchema>;

export const webhookEventTypeSchema = z.enum([
  "voucher.captured",
  "voucher.refunded",
  "voucher.expired",
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const webhookSubscriptionSchema = z.object({
  businessId: z.uuid(),
  url: z.url(),
  secretIssuedAt: z.iso.datetime(),
});
export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

/**
 * The signature spec `packages/sdk-merchant` verifies against (8.3.b/c):
 * header `X-YourTal-Signature: t=<unix seconds>,v1=<hex hmac-sha256>`, the
 * signed message is `${t}.${rawBody}`, keyed by the webhook's own secret
 * (issued alongside the URL, distinct from the merchant HMAC credential
 * above — a leaked webhook secret can forge deliveries, not redemptions).
 */
export const webhookSignatureHeaderSchema = z.string().regex(/^t=\d+,v1=[0-9a-f]{64}$/u);
