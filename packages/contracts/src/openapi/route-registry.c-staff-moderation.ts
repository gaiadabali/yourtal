import {
  approveVoucherBatchRequestSchema,
  listPendingVoucherBatchesResponseSchema,
  rejectVoucherBatchRequestSchema,
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
 * The rest of the moderation queue (9.2.a) is a separate file once it
 * lands, waiting on 7.3 -- this one only needs 7.4.
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
    "\"not found\" (docs/13c, mirroring settlement-decrease's approval_refused).",
  documented: true,
};

const MINT_FAILED: RouteErrorResponse = {
  status: 503,
  description:
    "voucher-internal's requestBatch/approveBatch (4.5) refused the mint (store/to-http-exception.ts's voucher_mint_failed).",
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
];
