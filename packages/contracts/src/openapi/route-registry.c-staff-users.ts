import {
  goodwillRequestSchema,
  goodwillResultSchema,
  setTrustTierRequestSchema,
  setTrustTierResultSchema,
  staffUserDetailSchema,
  staffUserLedgerHistorySchema,
  staffUserSearchResultSchema,
  suspendUserRequestSchema,
  suspendUserResultSchema,
  releaseUserResultSchema,
} from "../staff/users";
import {
  disputeResolutionResultSchema,
  resolveDisputeRequestSchema,
  staffDisputeQueueSchema,
} from "../staff/disputes";
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
 * Area C's staff users-and-support routes (TASKS.md 9.4), `apps/api/src/
 * modules/staff/{staff-users,staff-disputes}.controller.ts`. Its own file,
 * next to `route-registry.c-staff.ts` (9.1's `/api/staff/me`), so the two
 * Phase 9 tasks never edit the same file.
 */

const USER_ID_PARAM: RoutePathParam = {
  name: "userId",
  description: "The consumer account being viewed or acted on, by their platform user id.",
  schema: { type: "string", format: "uuid" },
};

const USER_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No account exists with this userId.",
  documented: true,
};

const ALREADY_SUSPENDED: RouteErrorResponse = {
  status: 409,
  description: "The account already has an open suspension (already_suspended).",
  documented: true,
};

const NOT_SUSPENDED: RouteErrorResponse = {
  status: 409,
  description: "The account has no open suspension to release (not_suspended).",
  documented: true,
};

const LEDGER_CONFLICT: RouteErrorResponse = {
  status: 409,
  description:
    "The ledger refused: an idempotency key was reused for different terms, or (for goodwill) " +
    "the account did not hold enough available/pending points.",
  documented: true,
};

export const STAFF_USERS_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/staff/users",
    summary: "Search accounts by email or user id (TASKS.md 9.4.a)",
    tags: ["staff"],
    pathParams: [],
    queryParams: [
      {
        name: "email",
        description: "Exact match, case-insensitive.",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "userId",
        description: "Exact match.",
        required: false,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "region",
        description: "Narrows the search to one region.",
        required: false,
        schema: { type: "string", enum: ["AU", "ID"] },
      },
    ],
    successStatus: 200,
    successDescription: "Every matching account (at most 50).",
    successSchema: inlineSchema(staffUserSearchResultSchema),
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/staff/users/{userId}",
    summary: "An account's profile and ledger balance (TASKS.md 9.4.a)",
    tags: ["staff"],
    pathParams: [USER_ID_PARAM],
    successStatus: 200,
    successDescription: "The account's profile and current available/pending points.",
    successSchema: inlineSchema(staffUserDetailSchema),
    errors: [FORBIDDEN, USER_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/staff/users/{userId}/ledger",
    summary: "An account's ledger history (TASKS.md 9.4.a)",
    tags: ["staff"],
    pathParams: [USER_ID_PARAM],
    successStatus: 200,
    successDescription: "The account's most recent ledger entries.",
    successSchema: inlineSchema(staffUserLedgerHistorySchema),
    errors: [FORBIDDEN, USER_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/users/{userId}/suspend",
    summary: "Suspend an account into escrow (TASKS.md 9.4.b)",
    tags: ["staff"],
    pathParams: [USER_ID_PARAM],
    requestBody: {
      description: "Why the account is being suspended.",
      schema: inlineSchema(suspendUserRequestSchema),
    },
    successStatus: 201,
    successDescription:
      "Available and pending points moved to a ledger escrow (never zeroed), and the account marked suspended.",
    successSchema: inlineSchema(suspendUserResultSchema),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      USER_NOT_FOUND,
      ALREADY_SUSPENDED,
      LEDGER_CONFLICT,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/staff/users/{userId}/release",
    summary: "Release a suspended account (TASKS.md 9.4.b)",
    tags: ["staff"],
    pathParams: [USER_ID_PARAM],
    successStatus: 201,
    successDescription:
      "The escrow released, points returned to available and pending exactly as they were.",
    successSchema: inlineSchema(releaseUserResultSchema),
    errors: [FORBIDDEN, USER_NOT_FOUND, NOT_SUSPENDED, LEDGER_CONFLICT, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/users/{userId}/goodwill",
    summary:
      "Issue a marketing-funded goodwill credit within the F12 per-case limit (TASKS.md 9.4.c)",
    tags: ["staff"],
    pathParams: [USER_ID_PARAM],
    requestBody: {
      description: "The credit and the mandatory reason for it.",
      schema: inlineSchema(goodwillRequestSchema),
    },
    successStatus: 201,
    successDescription: "The goodwill grant, from the region's marketing allocation.",
    successSchema: inlineSchema(goodwillResultSchema),
    errors: [VALIDATION_400, FORBIDDEN, USER_NOT_FOUND, LEDGER_CONFLICT, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/users/{userId}/trust-tier",
    summary: "Set an account's F12 holdback tier (TASKS.md 9.4.d, risk_analyst only)",
    tags: ["staff"],
    pathParams: [USER_ID_PARAM],
    requestBody: {
      description: "The new tier (0-3) and the mandatory reason for it. Never shown to the user.",
      schema: inlineSchema(setTrustTierRequestSchema),
    },
    successStatus: 201,
    successDescription: "The account's new trust tier.",
    successSchema: inlineSchema(setTrustTierResultSchema),
    errors: [VALIDATION_400, FORBIDDEN, USER_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
];

export const STAFF_DISPUTES_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/staff/disputes",
    summary: "The captured-voucher dispute queue (TASKS.md 9.4.d, K13)",
    tags: ["staff"],
    pathParams: [],
    queryParams: [
      {
        name: "region",
        description: "Narrows the queue to one region.",
        required: false,
        schema: { type: "string", enum: ["AU", "ID"] },
      },
    ],
    successStatus: 200,
    successDescription:
      "Every captured-voucher dispute waiting for staff (checkout.dispute where outcome = 'queued'), oldest first. List-only -- resolving one is TASKS.md 10.5.",
    successSchema: inlineSchema(staffDisputeQueueSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/disputes/{voucherId}/resolve",
    summary:
      "Resolve a K13 dispute, posting a recovery line against the merchant (TASKS.md 10.5.b)",
    tags: ["staff"],
    pathParams: [
      {
        name: "voucherId",
        description: "The disputed voucher (checkout.dispute.voucher_id).",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      description: "Why the dispute is resolved in the user's favour.",
      schema: inlineSchema(resolveDisputeRequestSchema),
    },
    successStatus: 201,
    successDescription:
      "The recovery line posted to the ledger (reversing the S-scaled payable the original capture posted). Shows up as recoveriesMinor on the merchant's next statement.",
    successSchema: inlineSchema(disputeResolutionResultSchema),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      {
        status: 404,
        description: "No such dispute, or its voucher was never captured (capture_not_found).",
        documented: true,
      },
      {
        status: 409,
        description: "This dispute was already resolved (already_resolved).",
        documented: true,
      },
      SERVICE_UNAVAILABLE,
    ],
  },
];
