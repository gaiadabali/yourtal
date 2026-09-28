"use server";

import { z } from "zod";
import {
  merchantDeveloperCredentialSchema,
  webhookSubscriptionSchema,
  type IssueDeveloperCredentialRequest,
  type MerchantDeveloperCredential,
  type WebhookSubscription,
} from "@yourtal/contracts/merchant/merchant-developer-credential";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";

/**
 * TASKS.md 8.3.a: Studio -> Developers, against A's merged
 * `studio-developers.controller.ts` (`GET/POST
 * /api/:tenantId/studio/developers/credentials`, `.../:credentialId/rotate`,
 * `DELETE .../:credentialId`, `POST .../webhooks`, merged 01194357).
 */

const listCredentialsSchema = z.array(merchantDeveloperCredentialSchema);

export async function listCredentialsLive(
  businessId: string,
): Promise<ApiResult<MerchantDeveloperCredential[]>> {
  return apiFetch(`/api/${businessId}/studio/developers/credentials`, listCredentialsSchema);
}

export async function issueCredentialLive(
  businessId: string,
  input: IssueDeveloperCredentialRequest,
): Promise<ApiResult<MerchantDeveloperCredential>> {
  return apiFetch(
    `/api/${businessId}/studio/developers/credentials`,
    merchantDeveloperCredentialSchema,
    { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: input },
  );
}

export async function rotateCredentialLive(
  businessId: string,
  credentialId: string,
): Promise<ApiResult<MerchantDeveloperCredential>> {
  return apiFetch(
    `/api/${businessId}/studio/developers/credentials/${credentialId}/rotate`,
    merchantDeveloperCredentialSchema,
    { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } },
  );
}

const revokeResponseSchema = z.object({ revoked: z.literal(true) });

export async function revokeCredentialLive(
  businessId: string,
  credentialId: string,
): Promise<ApiResult<{ revoked: true }>> {
  return apiFetch(
    `/api/${businessId}/studio/developers/credentials/${credentialId}`,
    revokeResponseSchema,
    { method: "DELETE" },
  );
}

export async function registerWebhookLive(
  businessId: string,
  url: string,
): Promise<ApiResult<WebhookSubscription>> {
  return apiFetch(`/api/${businessId}/studio/developers/webhooks`, webhookSubscriptionSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { url },
  });
}
