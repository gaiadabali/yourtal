import {
  boostChargeListSchema,
  boostChargeSchema,
  boostDaySchema,
  boostStateSchema,
  boostViewSchema,
  setBoostRequestSchema,
} from "../studio/boost";
import type { ContractComponent } from "./schema-registry";

/** 13.23: business boost, split out for the 300-line ceiling. */
export const BOOST_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "BoostState",
    schema: boostStateSchema,
    description: "Whether a boost is bidding (active) or held (paused).",
    crossFieldRules: [],
  },
  {
    id: "SetBoostRequest",
    schema: setBoostRequestSchema,
    description:
      "A live campaign's boost: a daily cash budget and a maximum bid per 1,000 boosted impressions, in the business's own currency's minor units.",
    crossFieldRules: ["endsAt must be after startsAt."],
  },
  {
    id: "BoostDay",
    schema: boostDaySchema,
    description:
      "One region-local day of boost delivery and its spend, rounded up to a minor unit.",
    crossFieldRules: [],
  },
  {
    id: "BoostView",
    schema: boostViewSchema,
    description:
      "A campaign's boost setting, the region's reserve price, and its boosted impressions, spend and average price paid.",
    crossFieldRules: [],
  },
  {
    id: "BoostCharge",
    schema: boostChargeSchema,
    description: "One closed day's boost spend, charged in cash through the payment driver.",
    crossFieldRules: [],
  },
  {
    id: "BoostChargeList",
    schema: boostChargeListSchema,
    description: "GET /api/{tenantId}/studio/billing/boost-charges's response.",
    crossFieldRules: [],
  },
];
