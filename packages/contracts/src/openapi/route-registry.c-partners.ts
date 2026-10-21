import {
  partnerActionRequestSchema,
  partnerActionResultSchema,
  partnerLinkRequestSchema,
  partnerLinkResultSchema,
  partnerLinkRevokeResultSchema,
  partnerReceiptStatusRequestSchema,
  partnerReceiptStatusResultSchema,
} from "../device/partner-action";
import {
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
} from "./route-registry-shared";

/** `partners/*.controller.ts` (TASKS.md 8.4.a, 14.3) — a partner app's (SnapApp's) integration. */

const INVALID_PARTNER_SIGNATURE: RouteErrorResponse = {
  status: 401,
  description: "No valid partner signature presented (partners/partner-auth.ts).",
  documented: true,
};

const INVALID_LINK_CODE: RouteErrorResponse = {
  status: 400,
  description: "The link code is unknown, expired or already used (invalid_link_code).",
  documented: true,
};

const UNKNOWN_LINK: RouteErrorResponse = {
  status: 400,
  description: "No link with this id exists for this partner (unknown_link).",
  documented: true,
};

const TEEN_NOT_ALLOWED: RouteErrorResponse = {
  status: 403,
  description: "A teen account cannot link a partner app (teen_consent_not_allowed, F101/F105).",
  documented: true,
};

const LINK_REVOKED: RouteErrorResponse = {
  status: 403,
  description: "The user unlinked this app; the link earns nothing (link_revoked).",
  documented: true,
};

const RECEIPTS_PAUSED: RouteErrorResponse = {
  status: 409,
  description:
    "The receipt package is used up, so nothing was paid (allocation_exhausted: " +
    '"receipt points are paused: the receipt package is used up"). Show receipt points as paused and ' +
    "stop retrying; poll the status read to see when they resume.",
  documented: true,
};

const IDENTITY_CHECK_REQUIRED: RouteErrorResponse = {
  status: 403,
  description:
    "The account has not passed YourTal's identity check, so it earns nothing and the receipt is " +
    "not recorded (identity_check_required). missing lists what the user still has to do " +
    "(verify_email, use_permanent_email). The refusal is final: do not resend the receipt. The " +
    "body carries the linkId to use next time.",
  documented: true,
};

const LEDGER_REFUSED: RouteErrorResponse = {
  status: 409,
  description:
    "The ledger refused the grant (its own code, e.g. a daily cap or an unfunded region).",
  documented: true,
};

export const PARTNERS_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/partners/links",
    summary: "Exchange a user's one-time link code for a lasting link",
    tags: ["partners"],
    pathParams: [],
    requestBody: {
      description: "The one-time code the user copied from YourTal's Me → Linked apps.",
      schema: inlineSchema(partnerLinkRequestSchema),
    },
    successStatus: 200,
    successDescription:
      "The link. A user already linked to this partner gets their existing link back.",
    successSchema: inlineSchema(partnerLinkResultSchema),
    errors: [
      VALIDATION_400,
      INVALID_LINK_CODE,
      INVALID_PARTNER_SIGNATURE,
      TEEN_NOT_ALLOWED,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/partners/links/{linkId}/revoke",
    summary: "End a link from the partner's side (the user left the partner app)",
    tags: ["partners"],
    pathParams: [
      {
        name: "linkId",
        description: "A link this partner holds.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    successStatus: 200,
    successDescription:
      "The link is revoked. Revoking an already-revoked link answers the same, with the original revokedAt.",
    successSchema: inlineSchema(partnerLinkRevokeResultSchema),
    errors: [UNKNOWN_LINK, INVALID_PARTNER_SIGNATURE, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/partners/actions",
    summary: "Grant points for a partner-verified action (a scanned receipt)",
    tags: ["partners"],
    pathParams: [],
    requestBody: {
      description:
        "The account (a link id, or a one-time link code on the first call), the action, and " +
        "the receipt's own reference.",
      schema: inlineSchema(partnerActionRequestSchema),
    },
    successStatus: 200,
    successDescription:
      "The grant. A receipt already reported is still a 200, with duplicate: true and no new payout.",
    successSchema: inlineSchema(partnerActionResultSchema),
    errors: [
      VALIDATION_400,
      INVALID_LINK_CODE,
      UNKNOWN_LINK,
      INVALID_PARTNER_SIGNATURE,
      TEEN_NOT_ALLOWED,
      LINK_REVOKED,
      IDENTITY_CHECK_REQUIRED,
      RECEIPTS_PAUSED,
      LEDGER_REFUSED,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/partners/receipts/status",
    summary: "Whether the partner's receipts are being paid from its receipt package",
    tags: ["partners"],
    pathParams: [],
    requestBody: {
      description: "The region to ask about.",
      schema: inlineSchema(partnerReceiptStatusRequestSchema),
    },
    successStatus: 200,
    successDescription:
      "earning is true when a receipt package has room for one receipt. A partner with no receipt package answers earning: false and remainingPoints: 0. A read: it needs no Idempotency-Key.",
    successSchema: inlineSchema(partnerReceiptStatusResultSchema),
    errors: [VALIDATION_400, INVALID_PARTNER_SIGNATURE, SERVICE_UNAVAILABLE],
  },
];
