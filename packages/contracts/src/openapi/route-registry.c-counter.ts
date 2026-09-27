import {
  counterAuthorizationSchema,
  counterAuthorizeRequestSchema,
  counterCaptureRequestSchema,
  counterCaptureSchema,
  counterLookupRequestSchema,
  counterVoucherPreviewSchema,
} from "../device/counter-redemption";
import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  TENANT_ID_PARAM,
  arrayOf,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
  type RouteQueryParam,
} from "./route-registry-shared";

/**
 * The counter BFF (`counter.controller.ts`, TASKS.md 8.2) and Studio ->
 * Redemptions (`studio-redemptions.controller.ts`, 8.2.g), split from
 * `route-registry.c.ts` for the same 300-line-ceiling reason
 * `schema-registry-business.ts` gives — that file is already near 700 lines
 * without these.
 *
 * Every counter route is device-credential authenticated
 * (`@PublicRoute` at the NestJS-guard level, the PDP check run explicitly
 * in `device-authorize.ts` — see that file's own comment for why), so none
 * of these carry a `FORBIDDEN` entry the way a session-authenticated route
 * would: a refused device gets 401 (`DEVICE_UNAUTHORIZED`, already declared
 * in `route-registry.c.ts` for the pairing/unlock routes) from the same
 * mapper, or a 403 from a real Cerbos DENY once past that — both still just
 * `ErrorResponse`, so a single generic entry covers them without inventing
 * a third status this file would have to keep in sync by hand.
 */

const VOUCHER_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No voucher matches this code, or it belongs to a different merchant " +
    "(the ledger-internal audience_blocked code, mapped by counter/to-http-exception.ts).",
  documented: true,
};

const ALREADY_CAPTURED: RouteErrorResponse = {
  status: 409,
  description: "This authorization was already captured, or the voucher is not in a spendable state.",
  documented: true,
};

const COUNTER_UNAUTHORIZED: RouteErrorResponse = {
  status: 401,
  description: "No device credential presented, or it is unknown or revoked.",
  documented: true,
};

const LOCATION_QUERY_PARAM: RouteQueryParam = {
  name: "locationId",
  description: "Narrow to one location.",
  required: false,
  schema: { type: "string", format: "uuid" },
};

const DEVICE_QUERY_PARAM: RouteQueryParam = {
  name: "deviceId",
  description: "Narrow to one device.",
  required: false,
  schema: { type: "string", format: "uuid" },
};

const LIMIT_QUERY_PARAM: RouteQueryParam = {
  name: "limit",
  description: "At most this many rows, newest first. Default 50, max 200.",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: 200 },
};

const counterLookupRequestBodySchema = inlineSchema(counterLookupRequestSchema);
const counterAuthorizeRequestBodySchema = inlineSchema(counterAuthorizeRequestSchema);
const counterCaptureRequestBodySchema = inlineSchema(counterCaptureRequestSchema);

const counterLogResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { entries: arrayOf("CounterLogEntry") },
  required: ["entries"],
  additionalProperties: false,
};

const studioRedemptionResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { entries: arrayOf("StudioRedemptionEntry") },
  required: ["entries"],
  additionalProperties: false,
};

export const COUNTER_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  // --- counter/counter.controller.ts ---
  {
    method: "post",
    path: "/api/counter/lookup",
    summary: "Preview a scanned or typed voucher code, before authorizing it",
    tags: ["counter"],
    pathParams: [],
    requestBody: { description: "The voucher code.", schema: counterLookupRequestBodySchema },
    successStatus: 200,
    successDescription: "The voucher's merchant, offer and remaining value — no hold placed.",
    successSchema: inlineSchema(counterVoucherPreviewSchema),
    errors: [VALIDATION_400, COUNTER_UNAUTHORIZED, VOUCHER_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/counter/authorize",
    summary: "Place a hold against a voucher for an amount, order ref and order total",
    tags: ["counter"],
    pathParams: [],
    requestBody: {
      description: "The voucher code, the amount (omit for the full remaining value), and the order's own reference and total.",
      schema: counterAuthorizeRequestBodySchema,
    },
    successStatus: 200,
    successDescription: "The hold, expiring in 5 minutes.",
    successSchema: inlineSchema(counterAuthorizationSchema),
    errors: [VALIDATION_400, COUNTER_UNAUTHORIZED, VOUCHER_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/counter/capture",
    summary: "Capture a held authorization",
    tags: ["counter"],
    pathParams: [],
    requestBody: { description: "The authorization to capture.", schema: counterCaptureRequestBodySchema },
    successStatus: 200,
    successDescription: "The receipt — never reachable for a void or a refund (8.2.c).",
    successSchema: inlineSchema(counterCaptureSchema),
    errors: [VALIDATION_400, COUNTER_UNAUTHORIZED, ALREADY_CAPTURED, VOUCHER_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/counter/log",
    summary: "Today's captures at this device",
    tags: ["counter"],
    pathParams: [],
    successStatus: 200,
    successDescription: "Today's captures, newest first (redemption.yaml's logScope: \"today\").",
    successSchema: counterLogResponseSchema,
    errors: [COUNTER_UNAUTHORIZED, SERVICE_UNAVAILABLE],
  },

  // --- studio-redemptions.controller.ts ---
  {
    method: "get",
    path: "/api/{tenantId}/studio/redemptions",
    summary: "Recent captures per location and device",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM],
    queryParams: [LOCATION_QUERY_PARAM, DEVICE_QUERY_PARAM, LIMIT_QUERY_PARAM],
    successStatus: 200,
    successDescription: "Recent captures for this business, newest first.",
    successSchema: studioRedemptionResponseSchema,
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
];
