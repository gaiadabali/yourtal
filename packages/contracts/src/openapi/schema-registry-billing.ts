import {
  billingAllocationSchema,
  billingBalanceSchema,
  billingCampaignSpendSchema,
  billingCardSchema,
  billingStatementSchema,
  budgetAlertSchema,
  budgetAlertsSchema,
  cardPurchaseSchema,
  cardPurchaseStatusSchema,
  funderTypeSchema,
  pointPackageSchema,
  pointPackagesSchema,
  purchasePointsRequestSchema,
  purchaseQuoteSchema,
  purchaseResultSchema,
  receiptProgrammeViewSchema,
  raiseStatementDisputeRequestSchema,
  savedCardSchema,
  startCardSetupResultSchema,
} from "../billing/billing";
import { packageTierKeySchema } from "../billing/package-tiers";
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
    id: "PackageTierKey",
    schema: packageTierKeySchema,
    description:
      "14.13 (F122): a point package's key in its region's catalogue, e.g. starter, grow, scale.",
    crossFieldRules: [],
  },
  {
    id: "PointPackage",
    schema: pointPackageSchema,
    description:
      "14.13 (F122): one point package, priced by the ledger at P_issue less the tier's discount -- never the backing rate B. subtotalMinor is ex-GST; totalMinor adds GST at taxRateBps (F118: AU 10%, ID none). pricePer1000Minor and savingMinor are ex-GST, for display.",
    crossFieldRules: [],
  },
  {
    id: "PointPackages",
    schema: pointPackagesSchema,
    description: "14.13: every point package on sale in the business's region, smallest first.",
    crossFieldRules: [],
  },
  {
    id: "PurchaseQuote",
    schema: purchaseQuoteSchema,
    description: "14.13: one point package priced now; the same shape as PointPackage.",
    crossFieldRules: [],
  },
  {
    id: "PurchasePointsRequest",
    schema: purchasePointsRequestSchema,
    description:
      "Buy a point package (F121: always a package). currency is required and never defaulted (7.5.a) -- the caller states what it expects to be charged, and a mismatch against the business's own currency is refused rather than coerced.",
    crossFieldRules: [],
  },
  {
    id: "ReceiptProgrammeView",
    schema: receiptProgrammeViewSchema,
    description:
      "2.10.b (F127): the receipt funder's panel. partners are the partner ids it funds; earning is true while a receipt package has room for one receipt; every package is priced at cost (pricing at_cost) with GST on top.",
    crossFieldRules: [],
  },
  {
    id: "BudgetAlert",
    schema: budgetAlertSchema,
    description:
      "14.13.b (F121): a package or a campaign budget reached 50%, 80% or 100% used. Raised once each, and emailed to the owner and finance members. At 100% rewards stop.",
    crossFieldRules: [],
  },
  {
    id: "BudgetAlerts",
    schema: budgetAlertsSchema,
    description: "14.13.b: the business's budget alerts, newest first.",
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
      "5.1.a: a started card purchase. awaiting_payment carries the checkout page to send the browser to (checkoutUrl is set exactly then); paid carries the allocation already funded.",
    crossFieldRules: [],
  },
  {
    id: "CardPurchaseStatus",
    schema: cardPurchaseStatusSchema,
    description:
      "pending until the processor's verified webhook confirms payment; needs_review is money received that staff must settle; there are no refunds (F107).",
    crossFieldRules: [],
  },
  {
    id: "CardPurchase",
    schema: cardPurchaseSchema,
    description:
      "5.1.a: one card purchase of points, with its GST split (totalMinor = subtotalMinor + taxMinor), for the return page.",
    crossFieldRules: [],
  },
  {
    id: "SavedCard",
    schema: savedCardSchema,
    description: "A saved card as Studio shows it: brand, last four digits and expiry only.",
    crossFieldRules: [],
  },
  {
    id: "BillingCard",
    schema: billingCardSchema,
    description:
      "The business's card for boosts. required is true where boosts charge a saved card (AU on Stripe).",
    crossFieldRules: [],
  },
  {
    id: "StartCardSetupResult",
    schema: startCardSetupResultSchema,
    description:
      "Either a page to save the card on (checkoutUrl) or, when the processor saves it at once, the card; exactly one is set.",
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
    description:
      "One campaign's own spend: points granted to viewers and how many completions earned them.",
    crossFieldRules: [],
  },
  {
    id: "BillingStatement",
    schema: billingStatementSchema,
    description:
      "10.1.b/10.6.b: a weekly settlement statement, the Studio-facing view -- opening payable + captures - refunds - recoveries = closingPayableMinor.",
    crossFieldRules: [],
  },
  {
    id: "RaiseStatementDisputeRequest",
    schema: raiseStatementDisputeRequestSchema,
    description:
      "10.6.b: disputing a statement holds its payout until staff resolve it (10.6.a/10.5.a).",
    crossFieldRules: [],
  },
];
