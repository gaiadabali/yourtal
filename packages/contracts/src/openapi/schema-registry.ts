import type { ZodType } from "zod";
import { idrMinorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema, moneySchema } from "../money/money-value";
import { regionSchema } from "../region/region";
import {
  campaignKindSchema,
  campaignSchema,
  campaignScoringRuleSchema,
  campaignStatusSchema,
} from "../campaign/campaign";
import {
  listingCategorySchema,
  listingSchema,
  listingStatusSchema,
  partialRedemptionPolicySchema,
} from "../listing/listing";
import { campaignChapterSchema } from "../campaign/campaign-chapter";
import { campaignVideoSourceSchema } from "../campaign/campaign-video-source";
import { merchantLocationSchema } from "../listing/merchant-location";
import { voucherSchema, voucherStatusSchema } from "../voucher/voucher";
import { balanceSchema } from "../balance/balance";
import { walletHistoryEntryKindSchema, walletHistoryEntrySchema } from "../wallet/wallet-history";
import { BUSINESS_CONTRACT_COMPONENTS } from "./schema-registry-business";

/**
 * Which Zod schemas become OpenAPI components, and what each one loses on the
 * way out. YT-0031.
 *
 * ## The thing to understand about this file
 *
 * **JSON Schema cannot express a `.refine()`.** Every cross-field rule in
 * `packages/contracts` — "a quick campaign is 60 seconds or shorter", "what
 * the merchant is paid cannot exceed the face value" — is invisible in the
 * generated OpenAPI document, and therefore invisible to the Go types and to
 * any client generated from it. `z.toJSONSchema` drops them silently.
 *
 * Silently is the problem. A Go service that round-trips a `Listing` through
 * the generated struct will happily accept a settlement value above face
 * value, and nothing in the toolchain says so. So every schema here declares
 * its cross-field rules as prose, `build-document.ts` emits them into the
 * component description (where they reach generated Go and TS as doc
 * comments), and `openapi.test.ts` asserts the declared count matches the
 * refinements actually on the schema. Add a `.refine()` without documenting
 * it and CI fails.
 *
 * That converts a silent correctness hole into a reviewed one. It does NOT
 * close it: **the OpenAPI document is a weaker contract than the Zod schema,
 * permanently.** Anything that must enforce a cross-field rule has to run the
 * Zod schema, or re-implement the rule and test it. See `openapi/README.md`.
 */
export interface ContractComponent {
  /** OpenAPI component name — PascalCase, stable, part of the public API. */
  readonly id: string;
  readonly schema: ZodType;
  /** One line, emitted into the document and into generated doc comments. */
  readonly description: string;
  /**
   * Cross-field rules this schema enforces that JSON Schema cannot express.
   * Empty for leaf types. Verified against the real refinement count in
   * `openapi.test.ts` — this list is checked, not decorative.
   */
  readonly crossFieldRules: readonly string[];
}

export const CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  // --- money (docs/15: every amount is an integer in its minor unit) ---
  {
    id: "Points",
    schema: pointsSchema,
    description: "Platform points. Always a whole number; there is no fractional point.",
    crossFieldRules: [],
  },
  {
    id: "IdrMinorUnits",
    schema: idrMinorUnitsSchema,
    description:
      "Indonesian Rupiah as an integer number of SEN — one hundredth of a Rupiah. Rp 45.000 is 4500000. Settled by YT-0506 on 2026-09-20: ISO 4217 gives IDR a sen minor unit, Indonesian banking uses it (amounts appear as Rp 1.000,26), and Stripe treats IDR as two-decimal. This settles what we STORE, not what a processor accepts: Xendit publishes no amount-unit spec and Adyen flags IDR as diverging from ISO, so conversion belongs in each PSP adapter. Prefer Money, which carries its own currency.",
    crossFieldRules: [],
  },

  {
    id: "Currency",
    schema: currencySchema,
    description:
      "ISO 4217 code for a currency this platform prices in. Closed at AUD and IDR: a third means a new PSP, new tax rules and a new data plane (docs/15), not a config edit.",
    crossFieldRules: [],
  },
  {
    id: "Money",
    schema: moneySchema,
    description:
      "An integer amount that carries its own currency — Fowler's Money pattern per docs/12 section 3 (YT-0513). Deliberately carries NO minor-unit exponent: an amount can be stored, transported and added without one, and only rendering and settlement need it (see MINOR_UNIT). Prefer this over IdrMinorUnits, which names a currency it does not always hold.",
    crossFieldRules: [],
  },

  // --- region (docs/tasks/phase-u-ui.md YT-0405) ---
  {
    id: "Region",
    schema: regionSchema,
    description:
      "AU or ID — the region a user account belongs to, chosen once at registration. Determines locale, currency, and tax/regulatory setup; Australia is the real market, Indonesia is the proving ground.",
    crossFieldRules: [],
  },

  // --- campaign ---
  {
    id: "CampaignKind",
    schema: campaignKindSchema,
    description: "Long-form earn campaign, or a short Quick-feed item (docs/17 section 1.1).",
    crossFieldRules: [],
  },
  {
    id: "CampaignScoringRule",
    schema: campaignScoringRuleSchema,
    description: "Whether the reward is completion-only or completion plus an accuracy bonus.",
    crossFieldRules: [],
  },
  {
    id: "CampaignStatus",
    schema: campaignStatusSchema,
    description: "Lifecycle state as a viewer sees it.",
    crossFieldRules: [],
  },
  {
    id: "CampaignChapter",
    schema: campaignChapterSchema,
    description:
      "One chapter marker: title, start second and a back-loading reward weight (docs/06 section 3). No stored end second or absolute reward — both are derived from the campaign's other chapters and its own rewardPoints/durationSeconds (YT-0503).",
    crossFieldRules: [],
  },
  {
    id: "CampaignVideoSource",
    schema: campaignVideoSourceSchema,
    description: "Where the player resolves a campaign's video from, without guessing (YT-0503).",
    crossFieldRules: [],
  },
  {
    id: "Campaign",
    schema: campaignSchema,
    description:
      "The earn-loop unit. Duration, reward, data cost and question count are never optional — the entry card is a contract with the viewer (docs/17 section 1.2).",
    crossFieldRules: [
      "A quick campaign must be 60 seconds or shorter (docs/17 section 1.1).",
      "An accuracy bonus requires at least one question to score accuracy against.",
      "A long_form campaign must have at least one chapter; a quick campaign has none.",
      "The first chapter must start at second 0.",
      "Chapter start times must be strictly increasing.",
      "Every chapter must start before the campaign's own durationSeconds.",
    ],
  },

  // --- store ---
  {
    id: "MerchantLocation",
    schema: merchantLocationSchema,
    description:
      "One physical outlet a merchant redeems vouchers at: id, name, address and district (YT-0502).",
    crossFieldRules: [],
  },
  {
    id: "ListingCategory",
    schema: listingCategorySchema,
    description: "Top-level store category.",
    crossFieldRules: [],
  },
  {
    id: "ListingStatus",
    schema: listingStatusSchema,
    description: "Availability as the store surface displays it.",
    crossFieldRules: [],
  },
  {
    id: "PartialRedemptionPolicy",
    schema: partialRedemptionPolicySchema,
    description: "What happens when a voucher is spent below its face value (docs/09 section 8.2).",
    crossFieldRules: [],
  },
  {
    id: "Listing",
    schema: listingSchema,
    description: "A store listing: what it costs in points, what it settles at, and its stock.",
    crossFieldRules: [
      "stockRemaining cannot exceed stockTotal.",
      "settlementValueIdr (what the merchant is paid) cannot exceed faceValueIdr (docs/09 section 3).",
      "A sold_out listing must have zero stockRemaining.",
      "minimumSpendIdr is set if and only if the policy is minimum_spend.",
      "location ids must be unique within a listing.",
    ],
  },

  // --- voucher ---
  {
    id: "VoucherStatus",
    schema: voucherStatusSchema,
    description: "Voucher lifecycle state.",
    crossFieldRules: [],
  },
  {
    id: "Voucher",
    schema: voucherSchema,
    description: "An issued voucher held by a user, with its remaining value and expiry.",
    crossFieldRules: [
      "remainingValueIdr cannot exceed faceValueIdr.",
      "expiresAt must be after issuedAt.",
      "minimumSpendIdr is set if and only if the policy is minimum_spend.",
    ],
  },

  // --- wallet ---
  {
    id: "Balance",
    schema: balanceSchema,
    description:
      "What the Wallet surface answers: what do I have, what is coming, what am I about to lose (docs/17 section 3).",
    crossFieldRules: [
      "pendingUnlockAt is set if and only if pendingPoints is positive.",
      "expiringAt is set if and only if expiringPoints is positive.",
      "expiringPoints cannot exceed availablePoints — points still in holdback cannot be about to expire.",
    ],
  },
  {
    id: "WalletHistoryEntryKind",
    schema: walletHistoryEntryKindSchema,
    description: "What kind of ledger event this history entry reflects (YT-0504).",
    crossFieldRules: [],
  },
  {
    id: "WalletHistoryEntry",
    schema: walletHistoryEntrySchema,
    description:
      "One entry in the wallet's points history, in plain language, never a transaction code (docs/17 section 3).",
    crossFieldRules: [
      "an earn entry is always a credit.",
      "a burn entry is always a debit.",
      "an expiry entry is always a debit.",
    ],
  },

  // --- business, questions: see schema-registry-business.ts. Split out to
  // stay under the 300-line ceiling once YT-0502/0503/0504 added their
  // components here.
  ...BUSINESS_CONTRACT_COMPONENTS,
];
