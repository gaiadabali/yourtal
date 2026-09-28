import {
  approveBusinessKybRequestSchema,
  reinstateBusinessRequestSchema,
  rejectBusinessKybRequestSchema,
  staffBusinessDetailSchema,
  staffBusinessSummarySchema,
  suspendBusinessRequestSchema,
} from "../staff/businesses";
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
 * TASKS.md 9.3.a: the staff console's Businesses zone --
 * `apps/api/src/modules/business/staff-business-review.controller.ts`.
 * Every request/response shape here is `apps/api`-local (`@yourtal/contracts/
 * staff/businesses`, NOT published as a reusable component -- see
 * `openapi.test.ts`'s `NOT_PUBLISHED`, same treatment as 9.1's
 * `staffSessionSchema`), so every schema below is inlined rather than `ref`d.
 */

const BUSINESS_ID_PARAM: RoutePathParam = {
  name: "businessId",
  description: "The business under staff review.",
  schema: { type: "string", format: "uuid" },
};

const BUSINESS_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No business exists with this id (business/to-http-exception.ts's business_not_found).",
  documented: true,
};

const summarySchema = inlineSchema(staffBusinessSummarySchema);
const detailSchema = inlineSchema(staffBusinessDetailSchema);

export const STAFF_BUSINESSES_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/staff/businesses",
    summary: "Search/list every business, with its KYB and suspension status",
    tags: ["staff"],
    pathParams: [],
    queryParams: [
      {
        name: "search",
        description: "Matches legal name, display name or handle (case-insensitive substring).",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "region",
        description: "AU or ID. Omitted searches both.",
        required: false,
        schema: { type: "string", enum: ["AU", "ID"] },
      },
      {
        name: "limit",
        description: "Page size, default 25, max 100.",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100 },
      },
      {
        name: "offset",
        description: "Page offset, default 0.",
        required: false,
        schema: { type: "integer", minimum: 0 },
      },
    ],
    successStatus: 200,
    successDescription: "A page of businesses and the total matching count.",
    successSchema: {
      type: "object",
      properties: {
        businesses: { type: "array", items: summarySchema },
        total: { type: "integer" },
      },
      required: ["businesses", "total"],
    },
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/staff/businesses/{businessId}",
    summary: "One business's full profile, KYB status and documents",
    tags: ["staff"],
    pathParams: [BUSINESS_ID_PARAM],
    successStatus: 200,
    successDescription: "The business, its tax id, suspension status and every KYB document.",
    successSchema: detailSchema,
    errors: [FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/businesses/{businessId}/kyb/approve",
    summary: "Approve a business's KYB submission (ops only)",
    tags: ["staff"],
    pathParams: [BUSINESS_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(approveBusinessKybRequestSchema),
    },
    successStatus: 201,
    successDescription:
      "The business, now verified, with every submitted document marked verified.",
    successSchema: detailSchema,
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/businesses/{businessId}/kyb/reject",
    summary: "Reject a business's KYB submission (ops only)",
    tags: ["staff"],
    pathParams: [BUSINESS_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(rejectBusinessKybRequestSchema),
    },
    successStatus: 201,
    successDescription:
      "The business, still unverified, with every submitted document marked rejected.",
    successSchema: detailSchema,
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/businesses/{businessId}/suspend",
    summary:
      "Suspend a business (ops only): its campaigns leave the feed, submit and spend are blocked",
    tags: ["staff"],
    pathParams: [BUSINESS_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(suspendBusinessRequestSchema),
    },
    successStatus: 201,
    successDescription: "The business, now suspended.",
    successSchema: detailSchema,
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/businesses/{businessId}/reinstate",
    summary: "Reinstate a suspended business (ops only)",
    tags: ["staff"],
    pathParams: [BUSINESS_ID_PARAM],
    requestBody: {
      description: "Why -- required for the audit trail.",
      schema: inlineSchema(reinstateBusinessRequestSchema),
    },
    successStatus: 201,
    successDescription: "The business, no longer suspended.",
    successSchema: detailSchema,
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
];
