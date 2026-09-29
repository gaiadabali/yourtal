import {
  decideSettlementProposalBodySchema,
  proposePayoutBodySchema,
  resolveStatementDisputeBodySchema,
  settlementQueueSchema,
} from "../staff/staff-settlement";
import { economyProposalSchema } from "../staff/staff-economy";
import { statementSchema } from "../ledger-internal/economy";
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
 * TASKS.md 10.6.a: the staff console's settlement screens
 * (`apps/api/src/modules/staff/settlement/**`), alongside `api/staff/economy`
 * (route-registry.c-staff-economy.ts). Its own file so a concurrent 10.5
 * session's own registry file is never touched by this one.
 */

const REGION_PARAM: RoutePathParam = {
  name: "region",
  description: "AU or ID (F2) -- each region's settlement queue is separate.",
  schema: { type: "string", enum: ["AU", "ID"] },
};

const STATEMENT_ID_PARAM: RoutePathParam = {
  name: "id",
  description: "A `ledger.statement` id (services/ledger's own 10.1.b row).",
  schema: { type: "string" },
};

const PROPOSAL_ID_PARAM: RoutePathParam = {
  name: "proposalId",
  description: "A `staff.economy_proposal` row id, kind `approve_payout`.",
  schema: { type: "string" },
};

const STATEMENT_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No such statement.",
  documented: true,
};

const PROPOSAL_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No such pending payout proposal in this region.",
  documented: true,
};

const ALREADY_DECIDED: RouteErrorResponse = {
  status: 400,
  description: "This proposal was already approved (business.errors' `already_decided`).",
  documented: true,
};

const SELF_APPROVAL: RouteErrorResponse = {
  status: 403,
  description:
    "The approver is the same staff member who proposed this payout -- F23's two-person " +
    "rule (ledger_adjustment.yaml's `nobody-approves-their-own-adjustment`).",
  documented: true,
};

const SETTLEMENT_CONFLICT: RouteErrorResponse = {
  status: 409,
  description:
    "The statement is not `open` (already disputed or paid), or its F12 dispute window has " +
    "not closed yet (to-http-exception.ts maps the ledger's closed LedgerError enum).",
  documented: true,
};

export const STAFF_SETTLEMENT_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  // -- 10.6.a: the queue -- every open or disputed statement in a region --
  {
    method: "get",
    path: "/api/staff/settlement/{region}/queue",
    summary: "Every open or disputed statement in a region, oldest first (10.1.b's own queue)",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM],
    successStatus: 200,
    successDescription: "The region's settlement queue.",
    successSchema: inlineSchema(settlementQueueSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },

  // -- resolving a statement's own dispute (raised by the business, 10.6.b) --
  {
    method: "post",
    path: "/api/staff/settlement/statements/{id}/resolve-dispute",
    summary: "Clear a statement's dispute, returning it to `open` so it can still be approved",
    tags: ["staff-settlement"],
    pathParams: [STATEMENT_ID_PARAM],
    requestBody: {
      description: "A required resolution note, e.g. after posting a K13 recovery line (10.5.b).",
      schema: inlineSchema(resolveStatementDisputeBodySchema),
    },
    successStatus: 201,
    successDescription: "The statement, now `open` again.",
    successSchema: inlineSchema(statementSchema),
    errors: [VALIDATION_400, FORBIDDEN, STATEMENT_NOT_FOUND, SETTLEMENT_CONFLICT, SERVICE_UNAVAILABLE],
  },

  // -- payout approval, two-person (10.1.c) --
  {
    method: "get",
    path: "/api/staff/settlement/{region}/payout-proposals",
    summary: "Every payout proposal for the region, newest first",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM],
    successStatus: 200,
    successDescription: "Pending and decided payout proposals.",
    successSchema: { type: "array", items: inlineSchema(economyProposalSchema) },
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/settlement/{region}/statements/{id}/payout-proposals",
    summary: "Propose approving a statement's payout (10.1.c) -- needs a second staff member",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM, STATEMENT_ID_PARAM],
    requestBody: {
      description: "An optional reason. No ledger call yet -- this records intent only.",
      schema: inlineSchema(proposePayoutBodySchema),
    },
    successStatus: 201,
    successDescription: "The new, pending payout proposal.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/settlement/{region}/payout-proposals/{proposalId}/approve",
    summary: "Approve a pending payout -- calls ledger approvePayout, refused inside the F12 window",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM, PROPOSAL_ID_PARAM],
    requestBody: {
      description: "An optional decision note.",
      schema: inlineSchema(decideSettlementProposalBodySchema),
    },
    successStatus: 201,
    successDescription: "The decided proposal, with the ledger's own resulting statement attached.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      SELF_APPROVAL,
      PROPOSAL_NOT_FOUND,
      ALREADY_DECIDED,
      SETTLEMENT_CONFLICT,
      STATEMENT_NOT_FOUND,
      SERVICE_UNAVAILABLE,
    ],
  },
];
