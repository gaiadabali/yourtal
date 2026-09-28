import { partnerActionRequestSchema, partnerActionResultSchema } from "../device/partner-action";
import {
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
} from "./route-registry-shared";

/** `partner-actions.controller.ts` (TASKS.md 8.4.a) — snap-app's receipt-scan integration. */

const INVALID_PARTNER_SIGNATURE: RouteErrorResponse = {
  status: 401,
  description: "No valid partner signature presented (partners/partner-auth.ts).",
  documented: true,
};

const INVALID_LINK_CODE: RouteErrorResponse = {
  status: 400,
  description: "The link code is unknown or expired (partners.errors.ts's invalid_link_code).",
  documented: true,
};

const DUPLICATE_RECEIPT: RouteErrorResponse = {
  status: 409,
  description:
    "This (partner, receipt hash) pair was already granted (partners.errors.ts's duplicate_receipt).",
  documented: true,
};

export const PARTNERS_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/partners/actions",
    summary: "Grant points for a partner-verified action (snap-app's receipt scan)",
    tags: ["partners"],
    pathParams: [],
    requestBody: {
      description:
        "The 5.4.c link code naming the account, the action, and the receipt's own reference.",
      schema: inlineSchema(partnerActionRequestSchema),
    },
    successStatus: 200,
    successDescription: "The grant.",
    successSchema: inlineSchema(partnerActionResultSchema),
    errors: [
      VALIDATION_400,
      INVALID_PARTNER_SIGNATURE,
      INVALID_LINK_CODE,
      DUPLICATE_RECEIPT,
      SERVICE_UNAVAILABLE,
    ],
  },
];
