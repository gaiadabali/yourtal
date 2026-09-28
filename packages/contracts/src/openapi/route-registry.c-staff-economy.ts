import type { z } from "zod";
import {
  decideProposalBodySchema,
  economyOverviewSchema,
  economyProposalSchema,
  proposeManualPurchaseBodySchema,
  proposeMarketingFundingBodySchema,
  proposeRateBodySchema,
  proposeSettingBodySchema,
  rateScreenSchema,
  settingsScreenSchema,
} from "../staff/staff-economy";
import { killSwitchSchema, setKillSwitchRequestSchema } from "../voucher-internal/kill-switch";
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
 * TASKS.md 9.5: the staff console's economy screens
 * (`apps/api/src/modules/staff/economy/**`), alongside `api/staff/me`
 * (route-registry.c-staff.ts). Its own file, not that one, so 9.3/9.4/9.5's
 * three concurrent Phase 9 sessions never edit the same registry file.
 */

const REGION_PARAM: RoutePathParam = {
  name: "region",
  description: "AU or ID (F2) -- each region's economy is shown, changed and approved separately.",
  schema: { type: "string", enum: ["AU", "ID"] },
};

const PROPOSAL_ID_PARAM: RoutePathParam = {
  name: "id",
  description: "A `staff.economy_proposal` row id (migration 20260929050100).",
  schema: { type: "string" },
};

const NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No such pending proposal (or business, for a manual purchase) in this region.",
  documented: true,
};

const ALREADY_DECIDED: RouteErrorResponse = {
  status: 400,
  description: "This proposal was already approved or rejected (business.errors' `already_decided`).",
  documented: true,
};

const SELF_APPROVAL: RouteErrorResponse = {
  status: 403,
  description:
    "The approver is the same staff member who proposed this change -- F23's two-person rule, " +
    "refused twice over (Cerbos AND, for rate/setting changes, a database CHECK/trigger too).",
  documented: true,
};

const LEDGER_REFUSED: RouteErrorResponse = {
  status: 400,
  description: "The ledger refused the request (to-http-exception.ts maps its closed LedgerError enum).",
  documented: true,
};

const tripKillSwitchBodySchema = setKillSwitchRequestSchema.omit({ setBy: true });

function proposalRoutes(args: {
  readonly segment: string;
  readonly tag: string;
  readonly proposeSummary: string;
  readonly approveSummary: string;
  readonly proposeBodySchema: z.ZodType;
  readonly proposeBodyDescription: string;
  readonly listSummary?: string;
}): RouteDefinition[] {
  const routes: RouteDefinition[] = [
    {
      method: "post",
      path: `/api/staff/economy/{region}/${args.segment}`,
      summary: args.proposeSummary,
      tags: [args.tag],
      pathParams: [REGION_PARAM],
      requestBody: {
        description: args.proposeBodyDescription,
        schema: inlineSchema(args.proposeBodySchema),
      },
      successStatus: 201,
      successDescription: "The new, pending proposal.",
      successSchema: inlineSchema(economyProposalSchema),
      errors: [VALIDATION_400, FORBIDDEN, NOT_FOUND, LEDGER_REFUSED, SERVICE_UNAVAILABLE],
    },
    {
      method: "post",
      path: `/api/staff/economy/{region}/${args.segment}/{id}/approve`,
      summary: args.approveSummary,
      tags: [args.tag],
      pathParams: [REGION_PARAM, PROPOSAL_ID_PARAM],
      requestBody: {
        description: "An optional decision note.",
        schema: inlineSchema(decideProposalBodySchema),
      },
      successStatus: 201,
      successDescription: "The decided proposal, with the ledger's own result attached.",
      successSchema: inlineSchema(economyProposalSchema),
      errors: [
        VALIDATION_400,
        FORBIDDEN,
        SELF_APPROVAL,
        NOT_FOUND,
        ALREADY_DECIDED,
        LEDGER_REFUSED,
        SERVICE_UNAVAILABLE,
      ],
    },
  ];
  if (args.listSummary !== undefined) {
    routes.unshift({
      method: "get",
      path: `/api/staff/economy/{region}/${args.segment}`,
      summary: args.listSummary,
      tags: [args.tag],
      pathParams: [REGION_PARAM],
      successStatus: 200,
      successDescription: "Every proposal of this kind for the region, newest first.",
      successSchema: economyProposalArraySchema(),
      errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
    });
  }
  return routes;
}

/** `arrayOf` (route-registry-shared.ts) only works for a REGISTERED component; `economyProposalSchema` is inlined, not registered, so its array form is built the same way `inlineSchema` builds the single one. */
function economyProposalArraySchema(): Record<string, unknown> {
  return { type: "array", items: inlineSchema(economyProposalSchema) };
}

export const STAFF_ECONOMY_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  // -- 9.5.a: overview --
  {
    method: "get",
    path: "/api/staff/economy/{region}/overview",
    summary: "Coverage, daily issuance/burn, reserve, reported spread and manual point purchases",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM],
    successStatus: 200,
    successDescription: "The region's economy overview. B (the backing rate) never appears here.",
    successSchema: inlineSchema(economyOverviewSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },

  // -- 9.5.b: rate management -- finance only --
  //
  // F54 (2026-09-29, founder-approved): `GET .../rate` and
  // `POST .../rate/proposals` genuinely carry `backingRateMicrosPerPoint`
  // (B) -- a human has to see and choose that number to change it. Area A's
  // `money/no-backing-rate-in-api.test.ts` (4.9.d) now carves out
  // `/api/staff/**` by path prefix for exactly this reason, with its own
  // assertion that the carve-out is genuinely exercised here and nowhere
  // else -- see that file's header. `components.schemas` stays strict
  // (never exempt), which is why B is inlined with `inlineSchema` below
  // rather than promoted to a named, cross-route component.
  {
    method: "get",
    path: "/api/staff/economy/{region}/rate",
    summary: "The current backing rate and any pending rate-change proposals (finance only)",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM],
    successStatus: 200,
    successDescription:
      "B, reverse-derived from coverage() (coverage-math.ts) -- never returned by any other route.",
    successSchema: inlineSchema(rateScreenSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/economy/{region}/rate/proposals",
    summary: "Propose a backing-rate change (9.5.b) -- needs a second staff member to approve",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM],
    requestBody: {
      description: "The new backing rate, in micros per point (finance only, F54).",
      schema: inlineSchema(proposeRateBodySchema),
    },
    successStatus: 201,
    successDescription: "The new, pending rate-change proposal.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [VALIDATION_400, FORBIDDEN, LEDGER_REFUSED, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/economy/{region}/rate/proposals/{id}/approve",
    summary: "Approve a pending backing-rate change -- refused if the approver proposed it",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM, PROPOSAL_ID_PARAM],
    requestBody: {
      description: "An optional decision note.",
      schema: inlineSchema(decideProposalBodySchema),
    },
    successStatus: 201,
    successDescription:
      "The decided proposal. Never carries B -- economyProposalSchema strips the ledger's raw result.",
    successSchema: inlineSchema(economyProposalSchema),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      SELF_APPROVAL,
      NOT_FOUND,
      ALREADY_DECIDED,
      LEDGER_REFUSED,
      SERVICE_UNAVAILABLE,
    ],
  },

  // -- 9.5.c: marketing funding -- two-person --
  ...proposalRoutes({
    segment: "marketing-fundings",
    tag: "staff-economy",
    listSummary: "Every marketing-funding proposal for the region",
    proposeSummary: "Propose marketing funding (9.5.c) -- needs a second staff member to approve",
    approveSummary: "Approve pending marketing funding -- calls ledger fundMarketing",
    proposeBodySchema: proposeMarketingFundingBodySchema,
    proposeBodyDescription: "The amount to fund, in the region's minor currency unit.",
  }),

  // -- 9.5.c: manual point purchase -- bank-transfer reference, two-person --
  ...proposalRoutes({
    segment: "purchases",
    tag: "staff-economy",
    proposeSummary:
      "Record a manual point purchase from a bank-transfer reference (9.5.c) -- two-person",
    approveSummary: "Approve a pending manual purchase -- calls ledger purchasePoints",
    proposeBodySchema: proposeManualPurchaseBodySchema,
    proposeBodyDescription: "The business, points, amount paid and bank reference.",
  }),

  // -- 9.5.d: every F12 setting, per region, plus points expiry (F2) --
  {
    method: "get",
    path: "/api/staff/economy/{region}/settings",
    summary: "Every current, approved region setting, and any pending proposals",
    tags: ["staff-economy"],
    pathParams: [REGION_PARAM],
    successStatus: 200,
    successDescription: "F12's whole table, per region -- ceilings, caps, streak, holdback, expiry.",
    successSchema: inlineSchema(settingsScreenSchema),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  ...proposalRoutes({
    segment: "settings/proposals",
    tag: "staff-economy",
    proposeSummary: "Propose a change to one region setting (9.5.d) -- needs a second approver",
    approveSummary: "Approve a pending setting change",
    proposeBodySchema: proposeSettingBodySchema,
    proposeBodyDescription: "The setting's key (e.g. `daily_earn_cap`) and its new value.",
  }),

  // -- 9.5.c: kill switches -- ops only, single action, auditable --
  {
    method: "get",
    path: "/api/staff/economy/kill-switches",
    summary: "Every kill switch and its current state",
    tags: ["staff-economy"],
    pathParams: [],
    successStatus: 200,
    successDescription: "Merchant/listing/batch/global emergency stops (voucher-internal's own list).",
    successSchema: { type: "array", items: inlineSchema(killSwitchSchema) },
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/economy/kill-switches",
    summary: "Trip or clear a kill switch (docs/14 section 6: one click, auditable) -- ops only",
    tags: ["staff-economy"],
    pathParams: [],
    requestBody: {
      description: "The scope (merchant/listing/batch/global), target, reason and new state.",
      schema: inlineSchema(tripKillSwitchBodySchema),
    },
    successStatus: 201,
    successDescription: "The kill switch's new state.",
    successSchema: inlineSchema(killSwitchSchema),
    errors: [VALIDATION_400, FORBIDDEN, LEDGER_REFUSED, SERVICE_UNAVAILABLE],
  },
];
