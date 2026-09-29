import {
  staffRiskQueueSchema,
  staffRiskResolveRequestSchema,
  staffRiskResolveResultSchema,
} from "../staff/risk-queue";
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
 * TASKS.md 10.5.a: the real RiskGate's manual-review queue,
 * `apps/api/src/modules/staff/staff-risk-queue.controller.ts`. Its own
 * file, next to `route-registry.c-staff-users.ts`, for the same "two
 * sessions never edit the same file" reason that one's header gives.
 */

const FLAG_ID_PARAM: RoutePathParam = {
  name: "id",
  description: "The risk flag being resolved (ledger.risk_flag.id).",
  schema: { type: "string" },
};

const FLAG_NOT_PENDING: RouteErrorResponse = {
  status: 404,
  description: "No such flag, or it was already resolved (idempotency_conflict from the ledger).",
  documented: true,
};

export const STAFF_RISK_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/staff/risk/queue",
    summary: "List pending manual-review flags for one region (TASKS.md 10.5.a)",
    tags: ["staff"],
    pathParams: [],
    queryParams: [
      {
        name: "region",
        description: "The region whose queue to list.",
        required: true,
        schema: { type: "string", enum: ["AU", "ID"] },
      },
    ],
    successStatus: 200,
    successDescription: "Every pending flag, newest first.",
    successSchema: inlineSchema(staffRiskQueueSchema),
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/risk/queue/{id}/release",
    summary: "Dismiss a flag, releasing any escrow the RiskGate auto-held (TASKS.md 10.5.a)",
    tags: ["staff"],
    pathParams: [FLAG_ID_PARAM],
    requestBody: {
      description: "An optional note explaining the decision.",
      schema: inlineSchema(staffRiskResolveRequestSchema),
    },
    successStatus: 200,
    successDescription: "The flag, now released.",
    successSchema: inlineSchema(staffRiskResolveResultSchema),
    errors: [VALIDATION_400, FORBIDDEN, FLAG_NOT_PENDING, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/risk/queue/{id}/suspend",
    summary: "Escalate a flag: hold the account's current balance into escrow (TASKS.md 10.5.a)",
    tags: ["staff"],
    pathParams: [FLAG_ID_PARAM],
    requestBody: {
      description: "An optional note explaining the decision.",
      schema: inlineSchema(staffRiskResolveRequestSchema),
    },
    successStatus: 200,
    successDescription: "The flag, now suspended.",
    successSchema: inlineSchema(staffRiskResolveResultSchema),
    errors: [VALIDATION_400, FORBIDDEN, FLAG_NOT_PENDING, SERVICE_UNAVAILABLE],
  },
];
