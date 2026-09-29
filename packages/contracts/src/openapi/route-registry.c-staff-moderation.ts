import {
  approveCampaignModerationRequestSchema,
  approveListingModerationRequestSchema,
  approveVoucherBatchRequestSchema,
  listCampaignModerationQueueResponseSchema,
  listPendingListingModerationResponseSchema,
  listPendingVoucherBatchesResponseSchema,
  rejectCampaignModerationRequestSchema,
  rejectListingModerationRequestSchema,
  rejectVoucherBatchRequestSchema,
  staffCampaignModerationCampaignSchema,
  staffListingModerationItemSchema,
  staffVoucherBatchRequestSchema,
} from "../staff/moderation";
import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
  type RoutePathParam,
} from "./route-registry-shared";

/**
 * TASKS.md 9.2.c: the staff moderation queue's voucher-batch half --
 * `apps/api/src/modules/store/staff-voucher-batch-review.controller.ts`.
 * 9.2.a's campaign and listing halves are appended below.
 */

const REQUEST_ID_PARAM: RoutePathParam = {
  name: "requestId",
  description: "The pending `store.voucher_batch_request` under review.",
  schema: { type: "string", format: "uuid" },
};

const REQUEST_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No PENDING request exists with this id (store/to-http-exception.ts's " +
    "voucher_batch_request_not_found) -- also returned for an already-decided or self-requested " +
    "one, since the repository's own claiming WHERE clause cannot tell those apart from " +
    '"not found" (docs/13c, mirroring settlement-decrease\'s approval_refused).',
  documented: true,
};

const MINT_FAILED: RouteErrorResponse = {
  status: 503,
  description:
    "voucher-internal's requestBatch/approveBatch (4.5) refused the mint (store/to-http-exception.ts's voucher_mint_failed).",
  documented: true,
};

const CAMPAIGN_ID_PARAM: RoutePathParam = {
  name: "campaignId",
  description: "The `in_review` campaign under review.",
  schema: { type: "string", format: "uuid" },
};

const CAMPAIGN_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No campaign exists with this id (studio/to-http-exception.ts's campaign_not_found).",
  documented: true,
};

const LISTING_ID_PARAM: RoutePathParam = {
  name: "listingId",
  description: "The `pending_review` listing under review.",
  schema: { type: "string", format: "uuid" },
};

const LISTING_NOT_FOUND: RouteErrorResponse = {
  status: 400,
  description:
    "No PENDING_REVIEW listing exists with this id (store/to-http-exception.ts's " +
    "invalid_lifecycle_transition, a 400) -- also returned for an already-decided or " +
    "never-flagged listing, since `decideModeration`'s own claiming WHERE clause cannot " +
    'tell those apart from "not pending review".',
  documented: true,
};

const requestSchema = inlineSchema(staffVoucherBatchRequestSchema);

export const STAFF_MODERATION_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/staff/moderation/voucher-batches",
    summary: "List every pending voucher-batch request, across every business",
    tags: ["staff"],
    pathParams: [],
    successStatus: 200,
    successDescription: "Every request still `pending`, newest first.",
    successSchema: inlineSchema(listPendingVoucherBatchesResponseSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/moderation/voucher-batches/{requestId}/approve",
    summary: "Approve a voucher-batch request: mints it through 4.5 (moderator only)",
    tags: ["staff"],
    pathParams: [REQUEST_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(approveVoucherBatchRequestSchema),
    },
    successStatus: 201,
    successDescription: "The request, now `approved`, with the real `mintedBatchId`.",
    successSchema: requestSchema,
    errors: [VALIDATION_400, FORBIDDEN, REQUEST_NOT_FOUND, MINT_FAILED, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/moderation/voucher-batches/{requestId}/reject",
    summary: "Reject a voucher-batch request (moderator only)",
    tags: ["staff"],
    pathParams: [REQUEST_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(rejectVoucherBatchRequestSchema),
    },
    successStatus: 201,
    successDescription: "The request, now `rejected`.",
    successSchema: requestSchema,
    errors: [VALIDATION_400, FORBIDDEN, REQUEST_NOT_FOUND, SERVICE_UNAVAILABLE],
  },

  // -------------------------------------------------------------------------
  // 9.2.a: campaign creative + question bank
  // -------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/staff/moderation/campaigns",
    summary: "List every campaign awaiting the human moderation queue (moderator only)",
    tags: ["staff"],
    pathParams: [],
    successStatus: 200,
    successDescription:
      "Every `in_review` campaign, each with the automated screen's flags (question-bank PII/prediction, re-run at review time).",
    successSchema: inlineSchema(listCampaignModerationQueueResponseSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/moderation/campaigns/{campaignId}/approve",
    summary: "Approve an in-review campaign: it goes live (moderator only)",
    tags: ["staff"],
    pathParams: [CAMPAIGN_ID_PARAM],
    requestBody: {
      description:
        "Why -- required for the audit trail. `audience`/`contentCategory` optionally " +
        'override the business\'s own declared value ("confirm or change", 1.1.d).',
      schema: inlineSchema(approveCampaignModerationRequestSchema),
    },
    successStatus: 201,
    successDescription: "The campaign, now `live`.",
    successSchema: inlineSchema(staffCampaignModerationCampaignSchema),
    errors: [VALIDATION_400, FORBIDDEN, CAMPAIGN_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/moderation/campaigns/{campaignId}/reject",
    summary: "Reject an in-review campaign, with a reason Studio shows the business (moderator only)",
    tags: ["staff"],
    pathParams: [CAMPAIGN_ID_PARAM],
    requestBody: {
      description: "Why -- shown to the business in Studio, and required for the audit trail.",
      schema: inlineSchema(rejectCampaignModerationRequestSchema),
    },
    successStatus: 201,
    successDescription: "The campaign, now `rejected`, carrying the reason.",
    successSchema: inlineSchema(staffCampaignModerationCampaignSchema),
    errors: [VALIDATION_400, FORBIDDEN, CAMPAIGN_NOT_FOUND, SERVICE_UNAVAILABLE],
  },

  // -------------------------------------------------------------------------
  // 9.2.a: listings
  // -------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/staff/moderation/listings",
    summary: "List every listing the automated screen flagged for review (ops only)",
    tags: ["staff"],
    pathParams: [],
    successStatus: 200,
    successDescription:
      "Every `pending_review` listing -- only a listing with an adult_only contentCategory (1.1.d) is ever flagged.",
    successSchema: inlineSchema(listPendingListingModerationResponseSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/moderation/listings/{listingId}/approve",
    summary: "Approve a flagged listing: it joins the public catalogue (ops only)",
    tags: ["staff"],
    pathParams: [LISTING_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(approveListingModerationRequestSchema),
    },
    successStatus: 201,
    successDescription: "The listing, now `active`.",
    successSchema: inlineSchema(staffListingModerationItemSchema),
    errors: [VALIDATION_400, FORBIDDEN, LISTING_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/moderation/listings/{listingId}/reject",
    summary: "Reject a flagged listing (ops only)",
    tags: ["staff"],
    pathParams: [LISTING_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(rejectListingModerationRequestSchema),
    },
    successStatus: 201,
    successDescription: "The listing, now `rejected`.",
    successSchema: inlineSchema(staffListingModerationItemSchema),
    errors: [VALIDATION_400, FORBIDDEN, LISTING_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
];
