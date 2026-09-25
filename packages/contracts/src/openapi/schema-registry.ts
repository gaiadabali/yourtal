import type { ZodType } from "zod";
import { idrMinorUnitsSchema, minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema, moneySchema } from "../money/money-value";
import { campaignLifecycleStateSchema } from "../campaign/campaign-lifecycle";
import { campaignTermsSchema } from "../campaign/campaign-terms";
import {
  campaignFunderTypeSchema,
  campaignRewardConfigSchema,
} from "../campaign/campaign-reward-config";
import { watchSessionSchema, watchSessionStateSchema } from "../watch/watch-session";
import { watchProgressReportSchema } from "../watch/watch-progress-report";
import { presentedQuestionSchema } from "../question/presented-question";
import {
  bankQuestionSchema,
  piiScreenVerdictSchema,
  questionStatusSchema,
} from "../question/question-bank";
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
  publicListingSchema,
  listingStatusSchema,
  partialRedemptionPolicySchema,
  listingChannelSchema,
  partialRedemptionSchema,
} from "../listing/listing";
import { audienceSchema } from "../audience/audience";
import { campaignChapterSchema } from "../campaign/campaign-chapter";
import { campaignVideoSourceSchema } from "../campaign/campaign-video-source";
import { merchantLocationSchema } from "../listing/merchant-location";
import { voucherSchema, voucherStatusSchema } from "../voucher/voucher";
import { voucherLifecycleStateSchema, voucherVoidReasonSchema } from "../voucher/voucher-lifecycle";
import { balanceSchema } from "../balance/balance";
import { walletHistoryEntryKindSchema, walletHistoryEntrySchema } from "../wallet/wallet-history";
import {
  ageBandSchema as identityAgeBandSchema,
  displayLocaleSchema,
  userProfileSchema,
} from "../identity/user-profile";
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
      "Indonesian Rupiah as an integer number of whole Rupiah (exponent 0). Rp 45.000 is 45000. The stored unit follows the payment gateway (decision T-1, 2026-09-22), reversing the earlier sen decision. Prefer Money, which carries its own currency.",
    crossFieldRules: [],
  },

  {
    id: "MinorUnits",
    schema: minorUnitsSchema,
    description:
      "A whole number of some currency's minor unit, WITHOUT saying which (YT-0513). The currency is a sibling field on the same record — listingSchema.currency, voucherSchema.currency — one per record, so an amount can never be stored without its currency and two amounts on one record can never disagree. This replaced IdrMinorUnits on the wire: that brand named a currency it did not always hold, and AU fixtures stored AUD cents in a field typed IdrMinorUnits. Not a nested Money object, because the contracts-to-migrations drift gate maps each field to a snake_case column and a nested object needs columns corresponding to nothing; callers compose money(record.fooMinor, record.currency) at the point of use.",
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

  {
    id: "WatchSessionState",
    schema: watchSessionStateSchema,
    description:
      "A watch attempt's state (YT-0120). `superseded` is kept rather than deleted because an abandoned attempt's coverage is evidence; `void` is terminal and never pays.",
    crossFieldRules: [],
  },
  {
    id: "WatchSession",
    schema: watchSessionSchema,
    description:
      "A viewer's attempt at a campaign, held server-side so resuming is a property of the account rather than of a device (YT-0120). Carries the terms version it entered under, so an advertiser editing a live campaign cannot change what someone already watching is owed. Completion is decided by playback COVERAGE, never by the playhead — see decision O-4.",
    crossFieldRules: [],
  },
  {
    id: "WatchProgressReport",
    schema: watchProgressReportSchema,
    description:
      "One span of playback a client claims to have played. `reportedAt` is the client's clock and is recorded for audit only: the server judges a report against its OWN clock, because a claim of more playback than time has passed is arithmetically impossible rather than merely suspicious.",
    crossFieldRules: [],
  },

  {
    id: "PresentedQuestion",
    schema: presentedQuestionSchema,
    description:
      "A question as a VIEWER sees it (YT-0102). Has no field capable of holding an answer — the key is unrepresentable here rather than stripped per route. `Question` is the authoring and scoring form and must never be served: it carries correctOptionId and correctAnswer, and a client that holds the key can score itself, which under decision O-1 means deciding its own reward.",
    crossFieldRules: [],
  },
  {
    id: "QuestionStatus",
    schema: questionStatusSchema,
    description:
      "draft, approved or retired. Retired is not a delete: docs/18 section 11 expects the answer key to leak and wants an automatic response, and a deleted question takes with it the evidence of which cohort answered it.",
    crossFieldRules: [],
  },
  {
    id: "PiiScreenVerdict",
    schema: piiScreenVerdictSchema,
    description:
      "Whether a question has been screened for smuggled personal-data collection (docs/18 section 6). A reward-gated question is a uniquely effective way to harvest data a business could not otherwise ask for, so a clear verdict is required to reach `approved`. `needs_review` is deliberately distinct from `rejected` — 'nobody has looked' is a different fact from 'a human said no'.",
    crossFieldRules: [],
  },
  {
    id: "BankQuestion",
    schema: bankQuestionSchema,
    description:
      "A question's standing in a campaign's bank (YT-0102). Carries timesAsked and timesCorrect as COUNTERS rather than a stored accuracy rate: a rate loses the denominator, and 97% from four answers cannot be told from 97% from four thousand — a leak detector that cannot distinguish those fires on noise and gets muted.",
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

  {
    id: "CampaignLifecycleState",
    schema: campaignLifecycleStateSchema,
    description:
      "A campaign's AUTHORING state, owned by the advertiser console (YT-0101). Distinct from CampaignStatus, which is what a viewer sees: draft, in_review and rejected have no public form at all. The set is the union of two incomplete ones — 'rejected' (review said no, it never ran) and 'ended' (it ran and finished) are different facts and a model needs both. Transitions are enumerated, not ad hoc: there is deliberately no draft->live, because a campaign that can publish itself makes review advisory.",
    crossFieldRules: [],
  },
  {
    id: "CampaignTerms",
    schema: campaignTermsSchema,
    description:
      "An immutable version of what a campaign promised (YT-0101). A watch session references the version it entered under, so an advertiser editing a live campaign cannot change what someone already watching is owed. Versioned rather than copied per session: one row per distinct set of terms, and the history is the audit trail a dispute needs. Only reward-affecting fields mint a version — a title edit does not.",
    crossFieldRules: [],
  },
  {
    id: "CampaignFunderType",
    schema: campaignFunderTypeSchema,
    description:
      "Who is paying for a campaign's points: a partner's pre-purchased block, or the platform funding its own grants. They post to different contra accounts, so collapsing them would hide marketing spend inside funded issuance.",
    crossFieldRules: [],
  },
  {
    id: "CampaignRewardConfig",
    schema: campaignRewardConfigSchema,
    description:
      "Which ledger allocation funds a campaign and how much of it this campaign may use (YT-0101). Deliberately carries NO remaining balance: that number is owned by ledger.allocation, whose CHECK (remaining_points >= 0) and conditional drawdown are the real hard stop. A copy here would be a second total that disagrees the first time a grant lands between reads.",
    crossFieldRules: [
      "rewardPointsPerCompletion must be greater than zero.",
      "One completion (reward plus accuracy bonus) must fit within maxPointsForCampaign.",
    ],
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
    id: "Audience",
    schema: audienceSchema,
    description:
      "Who a campaign or listing may reach (TASKS.md 1.1.c): all_ages reaches everyone; teen and adult are age-gated; parents reaches 18+ and is boosted, never gated further, for accounts that declared the parent-of-young-children interest with ad-targeting consent.",
    crossFieldRules: [],
  },
  {
    id: "Campaign",
    schema: campaignSchema,
    description:
      "The earn-loop unit. Duration, reward, data cost and question count are never optional — the entry card is a contract with the viewer (docs/17 section 1.2).",
    crossFieldRules: [
      "A quick campaign must be 60 seconds or shorter (docs/17 section 1.1).",
      "A long-form campaign must have at least one chapter.",
      "A quick campaign must have no chapters.",
      "An accuracy bonus requires at least one question to score accuracy against.",
      "A long_form campaign must have at least one chapter; a quick campaign has none.",
      "The first chapter must start at second 0.",
      "Chapter start times must be strictly increasing.",
      "Every chapter must start before the campaign's own durationSeconds.",
      "endsAt must be after startsAt.",
      "teaserStartSeconds must be before the campaign ends.",
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
    id: "ListingChannel",
    schema: listingChannelSchema,
    description: "Where a listing may be redeemed (TASKS.md 1.1.a).",
    crossFieldRules: [],
  },
  {
    id: "PartialRedemption",
    schema: partialRedemptionSchema,
    description:
      "The counter-facing, two-value framing of partial redemption (TASKS.md 1.1.a) — see listing.ts's own comment for why this sits alongside PartialRedemptionPolicy rather than replacing it.",
    crossFieldRules: [],
  },
  {
    id: "Listing",
    schema: listingSchema,
    description: "A store listing: what it costs in points, what it settles at, and its stock.",
    crossFieldRules: [
      "stockRemaining cannot exceed stockTotal.",
      "settlementValueMinor (what the merchant is paid) cannot exceed faceValueMinor (docs/09 section 3).",
      "A sold_out listing must have zero stockRemaining.",
      "minimumSpendMinor is set if and only if the policy is minimum_spend.",
      "location ids must be unique within a listing.",
    ],
  },
  {
    id: "PublicListing",
    schema: publicListingSchema,
    description:
      "A store listing as the PUBLIC catalogue serves it. Identical to Listing except that " +
      "settlementValueMinor is absent: S beside priceInPoints publishes the backing rate B by " +
      "arithmetic, and docs/24 ID-1 rests on there being no published fixed cash rate. " +
      "Consumers of the public catalogue must generate against this, never Listing.",
    crossFieldRules: [
      "stockRemaining cannot exceed stockTotal.",
      "A sold_out listing must have zero stockRemaining.",
      "minimumSpendMinor is set if and only if the policy is minimum_spend.",
      "location ids must be unique within a listing.",
    ],
  },

  // --- voucher ---
  {
    id: "VoucherStatus",
    schema: voucherStatusSchema,
    description:
      "What a WALLET shows about a voucher. Derived from VoucherLifecycleState through publicVoucherStatusOf (YT-0142), never stored: storing both would be two copies of one fact and the copy is what goes stale. It deliberately cannot name an internal-only state — a voucher that is minted, allocated or held has no public form, and one with no public form 404s identically to a nonexistent id rather than confirming that id exists.",
    crossFieldRules: [],
  },
  {
    id: "VoucherLifecycleState",
    schema: voucherLifecycleStateSchema,
    description:
      "A voucher's INTERNAL lifecycle, owned by the voucher service (YT-0142). Distinct from VoucherStatus: 'minted' (issued, belongs to nobody) and 'held' (an authorization is outstanding against it) are facts no wallet should render. 'redeemed' and 'voided' are terminal — reviving a spent voucher would mean a state write can un-spend money, and a voided voucher that can come back makes the kill switch advisory. The one reversal is expired->active, inside a grace window, so an expiry job that ran against a wrong clock is recoverable.",
    crossFieldRules: [],
  },
  {
    id: "VoucherVoidReason",
    schema: voucherVoidReasonSchema,
    description:
      "Why a voucher was voided. Load-bearing rather than descriptive: a voucher voided by 'transfer' became somebody else's and its value still exists (docs/09 section 7's void-and-remint), while one voided for fraud did not — so the reason is an input to the public-status derivation, and a wallet can tell its owner which happened.",
    crossFieldRules: [],
  },
  {
    id: "Voucher",
    schema: voucherSchema,
    description: "An issued voucher held by a user, with its remaining value and expiry.",
    crossFieldRules: [
      "remainingValueMinor cannot exceed faceValueMinor.",
      "expiresAt must be after issuedAt.",
      "minimumSpendMinor is set if and only if the policy is minimum_spend.",
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

  // --- identity ---
  {
    id: "DisplayLocale",
    schema: displayLocaleSchema,
    description:
      "en-AU or id-ID — a display-language choice, independent of Region (1.4.a). Defaults to en-AU at registration (0.5.a).",
    crossFieldRules: [],
  },
  {
    id: "AgeBand",
    schema: identityAgeBandSchema,
    description:
      "Computed from date of birth when a profile is read, never stored (1.4.a). Under-13 never reaches here — that age has no account at all (1.4.b) — so this is a closed teen/adult union.",
    crossFieldRules: [],
  },
  {
    id: "UserProfile",
    schema: userProfileSchema,
    description:
      'The account\'s own profile, GET /api/me (1.4.d). trustTier, guardianEmail and parentConsentStatus are deliberately absent — F12: "the tier is never shown to users".',
    crossFieldRules: [],
  },

  // --- business, questions: see schema-registry-business.ts. Split out to
  // stay under the 300-line ceiling once YT-0502/0503/0504 added their
  // components here.
  ...BUSINESS_CONTRACT_COMPONENTS,
];
