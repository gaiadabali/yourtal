import {
  billingAllocationSchema,
  billingBalanceSchema,
  billingCampaignSpendSchema,
  funderTypeSchema,
  purchasePointsRequestSchema,
  purchaseQuoteSchema,
  purchaseResultSchema,
} from "../billing/billing";
import type { ContractComponent } from "./schema-registry";

/**
 * The billing-domain half of `CONTRACT_COMPONENTS` (7.5), split out of
 * `schema-registry.ts` for the same 300-line-ceiling reason
 * `schema-registry-business.ts` gives.
 *
 * `FunderType` and `PurchasePointsRequest` are registered here under their
 * own ids even though `ledger-internal/funding.ts` exports SAME-NAMED
 * schemas that `openapi.test.ts` already exempts as internal
 * (`LEDGER_AND_VOUCHER_INTERNAL_REASON`) -- that exemption is keyed by
 * export NAME, and would otherwise silently cover this module's PUBLIC
 * versions too by coincidence. Registering them properly means the OpenAPI
 * document actually documents Studio billing's own request/response shapes,
 * rather than resting on a name collision with a different, internal
 * contract.
 */
export const BILLING_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "FunderType",
    schema: funderTypeSchema,
    description:
      "Who funded an allocation's points: a business's own purchase (partner) or platform marketing spend (marketing, K6).",
    crossFieldRules: [],
  },
  {
    id: "PurchaseQuote",
    schema: purchaseQuoteSchema,
    description:
      "A points pack's price at F12's fixed rate (P_issue) -- never the backing rate B, which no Studio surface ever carries.",
    crossFieldRules: [],
  },
  {
    id: "PurchasePointsRequest",
    schema: purchasePointsRequestSchema,
    description:
      "Buy a pack of points. currency is required and never defaulted (7.5.a) -- the caller states what it expects to be charged, and a mismatch against the business's own currency is refused rather than coerced.",
    crossFieldRules: [],
  },
  {
    id: "BillingAllocation",
    schema: billingAllocationSchema,
    description:
      "A funded pool of points a business can spend on campaigns. remainingPoints already excludes active holds.",
    crossFieldRules: [],
  },
  {
    id: "PurchaseResult",
    schema: purchaseResultSchema,
    description:
      "What buying a pack produced: the funded allocation, what was actually charged, and the simulated payments driver's own reference.",
    crossFieldRules: [],
  },
  {
    id: "BillingBalance",
    schema: billingBalanceSchema,
    description: "A business's total and remaining points across every allocation it holds.",
    crossFieldRules: [],
  },
  {
    id: "BillingCampaignSpend",
    schema: billingCampaignSpendSchema,
    description: "One campaign's own spend: points granted to viewers and how many completions earned them.",
    crossFieldRules: [],
  },
];
