import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  TENANT_ID_PARAM,
  nestDefaultError,
  ref,
  type RouteDefinition,
  type RoutePathParam,
} from "./route-registry-shared";

/** 5.1.a: card purchases, the card for boosts, and the processor's webhook. */
const PURCHASE_ID_PARAM: RoutePathParam = {
  name: "purchaseId",
  description: "A card purchase this business started.",
  schema: { type: "string", format: "uuid" },
};

export const BILLING_CARD_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/{tenantId}/studio/billing/purchases/{purchaseId}",
    summary: "A card purchase's status, for the page the checkout returns to",
    tags: ["studio", "billing"],
    pathParams: [TENANT_ID_PARAM, PURCHASE_ID_PARAM],
    successStatus: 200,
    successDescription: "pending until the processor's webhook confirms the payment.",
    successSchema: ref("CardPurchase"),
    errors: [
      FORBIDDEN,
      nestDefaultError(404, "No purchase with this id belongs to this business."),
    ],
  },
  {
    method: "get",
    path: "/api/{tenantId}/studio/billing/card",
    summary: "The card boosts are charged to",
    tags: ["studio", "billing", "boost"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The saved card (brand, last four, expiry) or null, and whether one is required.",
    successSchema: ref("BillingCard"),
    errors: [FORBIDDEN],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/billing/card",
    summary: "Add or replace the card boosts are charged to",
    tags: ["studio", "billing", "boost"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 201,
    successDescription:
      "A page to save the card on (the card arrives with the webhook), or the card when saved at once.",
    successSchema: ref("StartCardSetupResult"),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/webhooks/stripe",
    summary: "Stripe's signed event delivery (public; the signature is the authentication)",
    tags: ["billing", "webhooks"],
    pathParams: [],
    requestBody: {
      description:
        "A Stripe event exactly as Stripe sends it, verified against the Stripe-Signature header on the raw body.",
      schema: { type: "object", additionalProperties: true },
    },
    successStatus: 200,
    successDescription: "Handled, already handled, or a type the app does not act on.",
    successSchema: {
      type: "object",
      properties: { received: { type: "boolean" } },
      required: ["received"],
    },
    errors: [
      nestDefaultError(
        400,
        "The signature does not verify, or the body is not an event. Not retried usefully.",
      ),
      nestDefaultError(500, "A handler failed; the sender retries the delivery."),
    ],
  },
];
