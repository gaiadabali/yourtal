import { decideProposalBodySchema, economyProposalSchema } from "../staff/staff-economy";
import { parkedPurchasesSchema, proposeRefundBodySchema } from "../staff/staff-parked-purchases";
import {
  checkDisbursementResultSchema,
  decideSettlementProposalBodySchema,
  proposeDisbursementRetryBodySchema,
} from "../staff/staff-settlement";
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
 * 5.1.g (F123) and 5.2.c: the staff money follow-ups. Parked card purchases are
 * refunded in full, and payouts the job will not move by itself are checked
 * again or retried; every refund and retry is two-person. Own file, like the
 * other staff registries, so concurrent sessions never edit the same one.
 */

const REGION_PARAM: RoutePathParam = {
  name: "region",
  description: "AU or ID (F2). Payouts exist in Australia only (F104).",
  schema: { type: "string", enum: ["AU", "ID"] },
};

const PURCHASE_ID_PARAM: RoutePathParam = {
  name: "purchaseId",
  description: "A parked `payment.card_purchase` id (status needs_review).",
  schema: { type: "string" },
};

const DISBURSEMENT_ID_PARAM: RoutePathParam = {
  name: "id",
  description: "A `payment.disbursement` id.",
  schema: { type: "string" },
};

const PROPOSAL_ID_PARAM: RoutePathParam = {
  name: "proposalId",
  description: "A `staff.economy_proposal` row id of kind refund_purchase or retry_disbursement.",
  schema: { type: "string" },
};

const NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No such parked purchase, payout or pending proposal in this region.",
  documented: true,
};

const SELF_APPROVAL: RouteErrorResponse = {
  status: 403,
  description:
    "The approver is the same staff member who proposed this -- F23's two-person rule " +
    "(ledger_adjustment.yaml's `nobody-approves-their-own-adjustment`).",
  documented: true,
};

const ALREADY_DECIDED: RouteErrorResponse = {
  status: 400,
  description: "This proposal was already approved or rejected (`already_decided`).",
  documented: true,
};

const CONFLICT: RouteErrorResponse = {
  status: 409,
  description:
    "The purchase or payout is not in a state this can act on (not parked, already refunded, " +
    "not stuck, changed since proposed), the processor shows the money moved, or it refused.",
  documented: true,
};

const PROCESSOR_UNAVAILABLE: RouteErrorResponse = {
  status: 503,
  description:
    "The processor could not be read, or did not confirm a refund; nothing is lost and the " +
    "same action can be repeated (a refund reuses its key).",
  documented: true,
};

export const STAFF_OPS_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  // -- 5.1.g: parked card purchases --
  {
    method: "get",
    path: "/api/staff/economy/{region}/parked-purchases",
    summary: "Card purchases the ledger would not turn into points, and the last refunded ones",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM],
    successStatus: 200,
    successDescription: "Parked purchases oldest payment first, then refunded, newest first.",
    successSchema: inlineSchema(parkedPurchasesSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/economy/{region}/parked-purchases/{purchaseId}/refund-proposals",
    summary:
      "Propose refunding a parked purchase to the card in full -- needs a second staff member",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM, PURCHASE_ID_PARAM],
    requestBody: {
      description: "The required reason. Nothing is claimed and no processor is called yet.",
      schema: inlineSchema(proposeRefundBodySchema),
    },
    successStatus: 201,
    successDescription: "The new, pending refund proposal.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [VALIDATION_400, FORBIDDEN, NOT_FOUND, CONFLICT],
  },
  {
    method: "post",
    path: "/api/staff/economy/{region}/refund-proposals/{id}/approve",
    summary: "Approve a refund -- refunds the card in full through the processor, once",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM, { ...PROPOSAL_ID_PARAM, name: "id" }],
    requestBody: {
      description: "An optional decision note.",
      schema: inlineSchema(decideProposalBodySchema),
    },
    successStatus: 201,
    successDescription: "The decided proposal; the purchase is now refunded.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      SELF_APPROVAL,
      NOT_FOUND,
      ALREADY_DECIDED,
      CONFLICT,
      PROCESSOR_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/staff/economy/{region}/refund-proposals/{id}/reject",
    summary: "Decline or withdraw a refund proposal (refused while a refund may be in flight)",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM, { ...PROPOSAL_ID_PARAM, name: "id" }],
    requestBody: {
      description: "An optional decision note.",
      schema: inlineSchema(decideProposalBodySchema),
    },
    successStatus: 201,
    successDescription: "The rejected proposal.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [VALIDATION_400, FORBIDDEN, NOT_FOUND, ALREADY_DECIDED, CONFLICT],
  },

  // -- 5.2.c: payouts never in flight unseen --
  {
    method: "post",
    path: "/api/staff/settlement/{region}/disbursements/{id}/check",
    summary: "Check a stuck payout again: read the processor and record what it shows",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM, DISBURSEMENT_ID_PARAM],
    successStatus: 201,
    successDescription: "What the processor showed, and the payout as it now stands.",
    successSchema: inlineSchema(checkDisbursementResultSchema),
    errors: [FORBIDDEN, NOT_FOUND, CONFLICT, PROCESSOR_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/settlement/{region}/disbursements/{id}/retry-proposals",
    summary: "Propose a retry of a stuck payout, once the processor shows nothing moved",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM, DISBURSEMENT_ID_PARAM],
    requestBody: {
      description: "The required reason.",
      schema: inlineSchema(proposeDisbursementRetryBodySchema),
    },
    successStatus: 201,
    successDescription: "The new, pending retry proposal.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [VALIDATION_400, FORBIDDEN, NOT_FOUND, CONFLICT, PROCESSOR_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/settlement/{region}/retry-proposals/{proposalId}/approve",
    summary:
      "Approve a retry -- a new payout attempt (never a second transfer), asked again of the processor",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM, PROPOSAL_ID_PARAM],
    requestBody: {
      description: "An optional decision note.",
      schema: inlineSchema(decideSettlementProposalBodySchema),
    },
    successStatus: 201,
    successDescription: "The decided proposal; the job sends the payout on its next run.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      SELF_APPROVAL,
      NOT_FOUND,
      ALREADY_DECIDED,
      CONFLICT,
      PROCESSOR_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/staff/settlement/{region}/retry-proposals/{proposalId}/reject",
    summary: "Decline or withdraw a retry proposal",
    tags: ["staff-settlement"],
    pathParams: [REGION_PARAM, PROPOSAL_ID_PARAM],
    requestBody: {
      description: "An optional decision note.",
      schema: inlineSchema(decideSettlementProposalBodySchema),
    },
    successStatus: 201,
    successDescription: "The rejected proposal.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [VALIDATION_400, FORBIDDEN, NOT_FOUND, ALREADY_DECIDED],
  },
];
