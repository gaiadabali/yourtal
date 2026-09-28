import {
  issueDeveloperCredentialRequestSchema,
  merchantDeveloperCredentialSchema,
  registerWebhookRequestSchema,
  webhookSubscriptionSchema,
} from "../merchant/merchant-developer-credential";
import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  TENANT_ID_PARAM,
  arrayOf,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
  type RoutePathParam,
} from "./route-registry-shared";

/**
 * `studio-developers.controller.ts` (TASKS.md 8.3.a/8.3.c), split from
 * `route-registry.c.ts` for the same 300-line-ceiling reason
 * `route-registry.c-counter.ts` gives.
 */

const CREDENTIAL_ID_PARAM: RoutePathParam = {
  name: "credentialId",
  description: "A merchant HMAC developer credential, targeted by its own id.",
  schema: { type: "string" },
};

const CREDENTIAL_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No such credential (devices.developers.errors.ts's credential_not_found).",
  documented: true,
};

const CREDENTIAL_NOT_OWNED: RouteErrorResponse = {
  status: 403,
  description:
    "The credential belongs to a different business (devices.developers.errors.ts's " +
    "credential_not_owned) — reuses the same 403 slot as FORBIDDEN; the envelope is identical.",
  documented: true,
};

const issueRequestBodySchema = inlineSchema(issueDeveloperCredentialRequestSchema);
const registerWebhookRequestBodySchema = inlineSchema(registerWebhookRequestSchema);

const revokedResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { revoked: { const: true } },
  required: ["revoked"],
  additionalProperties: false,
};

/** `register-webhook.use-case.ts`'s `RegisterWebhookResult` — `WebhookSubscription` plus the one-time secret. */
const registerWebhookResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    businessId: { type: "string", format: "uuid" },
    url: { type: "string" },
    secretIssuedAt: { type: "string", format: "date-time" },
    secret: { type: "string" },
  },
  required: ["businessId", "url", "secretIssuedAt", "secret"],
  additionalProperties: false,
};

export const DEVELOPERS_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/{tenantId}/studio/developers/credentials",
    summary: "List a business's merchant HMAC developer credentials",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "Every credential, never with a secret (only issue/rotate return one).",
    successSchema: arrayOf("MerchantDeveloperCredential"),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/developers/credentials",
    summary: "Issue a merchant HMAC developer credential",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "A label and whether this is a sandbox credential.",
      schema: issueRequestBodySchema,
    },
    successStatus: 201,
    successDescription: "The credential, with its secret shown exactly this once.",
    successSchema: inlineSchema(merchantDeveloperCredentialSchema),
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/developers/credentials/{credentialId}/rotate",
    summary: "Rotate a merchant HMAC developer credential",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM, CREDENTIAL_ID_PARAM],
    successStatus: 200,
    successDescription: "The credential, with its NEW secret shown exactly this once.",
    successSchema: inlineSchema(merchantDeveloperCredentialSchema),
    errors: [FORBIDDEN, CREDENTIAL_NOT_FOUND, CREDENTIAL_NOT_OWNED, SERVICE_UNAVAILABLE],
  },
  {
    method: "delete",
    path: "/api/{tenantId}/studio/developers/credentials/{credentialId}",
    summary: "Revoke a merchant HMAC developer credential",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM, CREDENTIAL_ID_PARAM],
    successStatus: 200,
    successDescription: "The credential is revoked; it stops authenticating immediately.",
    successSchema: revokedResponseSchema,
    errors: [FORBIDDEN, CREDENTIAL_NOT_FOUND, CREDENTIAL_NOT_OWNED, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/{tenantId}/studio/developers/webhooks",
    summary: "The business's current webhook registration, if any",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The registered URL, or null if none — never the secret (only registering returns one).",
    successSchema: inlineSchema(webhookSubscriptionSchema.nullable()),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/developers/webhooks",
    summary: "Register (or replace) a business's webhook delivery URL",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: { description: "The delivery URL.", schema: registerWebhookRequestBodySchema },
    successStatus: 200,
    successDescription: "The subscription, with its signing secret shown exactly this once.",
    successSchema: registerWebhookResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
  },
];
