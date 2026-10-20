import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  TENANT_ID_PARAM,
  nestDefaultError,
  ref,
  type RouteDefinition,
  type RoutePathParam,
} from "./route-registry-shared";

/** 5.2 (F103, F104): connected accounts for brands and charities, and approved payouts. */
const CHARITY_ID: RoutePathParam = {
  name: "charityId",
  description: "A charity in the registry.",
  schema: { type: "string", format: "uuid" },
};
const REGION_PARAM: RoutePathParam = {
  name: "region",
  description: "AU or ID (F2). Indonesia has no real payouts (F104).",
  schema: { type: "string", enum: ["AU", "ID"] },
};
const LINK_REFUSED = nestDefaultError(422, "The processor refused to open the page.");
const UNAVAILABLE_HERE = nestDefaultError(404, "Payouts are not offered in this region.");

export const PAYOUT_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/{tenantId}/studio/billing/payouts",
    summary: "Where approved statements are paid, and each one's payout",
    tags: ["studio", "billing", "payouts"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The connected account (not set up, in progress, ready with the bank's last four digits) and the approved payouts.",
    successSchema: ref("StudioPayouts"),
    errors: [FORBIDDEN, nestDefaultError(404, "No such business.")],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/billing/payouts/link",
    summary: "Set up payouts, or change the bank, on the processor's page",
    tags: ["studio", "billing", "payouts"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 201,
    successDescription:
      "The processor's onboarding page (account_onboarding the first time, account_update afterwards).",
    successSchema: ref("PayoutLink"),
    errors: [FORBIDDEN, UNAVAILABLE_HERE, LINK_REFUSED, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/charities/{charityId}/payouts",
    summary: "The charity's connected account, where auction proceeds are captured",
    tags: ["charity", "payouts"],
    pathParams: [CHARITY_ID],
    successStatus: 200,
    successDescription: "The account's state and the bank's last four digits.",
    successSchema: ref("CharityPayouts"),
    errors: [FORBIDDEN, nestDefaultError(404, "No such charity.")],
  },
  {
    method: "post",
    path: "/api/charities/{charityId}/payouts/link",
    summary: "A charity member sets up payouts, or changes the bank, on the processor's page",
    tags: ["charity", "payouts"],
    pathParams: [CHARITY_ID],
    successStatus: 201,
    successDescription: "The processor's onboarding page.",
    successSchema: ref("PayoutLink"),
    errors: [
      FORBIDDEN,
      UNAVAILABLE_HERE,
      nestDefaultError(409, "The charity is not approved yet."),
      LINK_REFUSED,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "get",
    path: "/api/staff/settlement/{region}/disbursements",
    summary: "What became of each approved payout: transfer, payout, failure",
    tags: ["staff", "settlement", "payouts"],
    pathParams: [REGION_PARAM],
    successStatus: 200,
    successDescription: "The region's disbursements, newest first.",
    successSchema: ref("StaffDisbursements"),
    errors: [FORBIDDEN, nestDefaultError(400, "Unknown region.")],
  },
];
