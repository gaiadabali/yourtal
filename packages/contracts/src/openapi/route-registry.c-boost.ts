import {
  FORBIDDEN,
  TENANT_ID_PARAM,
  VALIDATION_400,
  nestDefaultError,
  ref,
  type RouteDefinition,
  type RoutePathParam,
} from "./route-registry-shared";

/** 13.23: Studio boost routes, in their own file like the other C splits. */
const CAMPAIGN_ID_PARAM: RoutePathParam = {
  name: "campaignId",
  description: "The business's own campaign.",
  schema: { type: "string", format: "uuid" },
};
const NOT_FOUND = nestDefaultError(404, "No campaign with this id belongs to this business.");

export const BOOST_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/boost",
    summary: "A campaign's boost setting and delivery report",
    tags: ["studio", "boost"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The setting (or null), reserve price, impressions, spend and average price.",
    successSchema: ref("BoostView"),
    errors: [FORBIDDEN, NOT_FOUND],
  },
  {
    method: "put",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/boost",
    summary: "Set a live campaign's boost budget and maximum bid",
    tags: ["studio", "boost"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    requestBody: {
      description: "Daily budget and maximum bid per 1,000 impressions, with the dates it runs.",
      schema: ref("SetBoostRequest"),
    },
    successStatus: 200,
    successDescription: "The saved setting with its report.",
    successSchema: ref("BoostView"),
    errors: [VALIDATION_400, FORBIDDEN, NOT_FOUND],
  },
  {
    method: "get",
    path: "/api/{tenantId}/studio/billing/boost-charges",
    summary: "The business's boost charges, one per campaign per closed day",
    tags: ["studio", "billing", "boost"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "Newest first.",
    successSchema: ref("BoostChargeList"),
    errors: [FORBIDDEN],
  },
];
