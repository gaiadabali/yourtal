import type { ZodType } from "zod";
import { idrMinorUnitsSchema, pointsSchema } from "../money/money";
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
import { voucherSchema, voucherStatusSchema } from "../voucher/voucher";
import { balanceSchema } from "../balance/balance";
import { businessRoleSchema, businessSchema } from "../business/business";
import { businessTeamRoleSchema } from "../business/business-team-role";
import { businessMemberSchema } from "../business/business-member";
import { billingContactSchema } from "../business/billing-contact";
import {
  kybDocumentSchema,
  kybDocumentStatusSchema,
  kybDocumentTypeSchema,
} from "../business/kyb-document";
import { questionOptionSchema, questionSchema } from "../question/question";

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
      "Indonesian Rupiah as an integer. The minor unit for IDR is defined as exactly 1 Rupiah, so these values ARE Rupiah counts. There is no cents-of-Rupiah concept.",
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
    id: "Campaign",
    schema: campaignSchema,
    description:
      "The earn-loop unit. Duration, reward, data cost and question count are never optional — the entry card is a contract with the viewer (docs/17 section 1.2).",
    crossFieldRules: [
      "A quick campaign must be 60 seconds or shorter (docs/17 section 1.1).",
      "An accuracy bonus requires at least one question to score accuracy against.",
    ],
  },

  // --- store ---
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

  // --- business ---
  {
    id: "BusinessRole",
    schema: businessRoleSchema,
    description:
      "A relationship a business holds with the platform, of which it may hold any subset (docs/17 section 2). NOT the per-person team role — that is BusinessTeamRole.",
    crossFieldRules: [],
  },
  {
    id: "BusinessTeamRole",
    schema: businessTeamRoleSchema,
    description:
      "The job one person does inside one business (docs/17 section 2.1). Defined here rather than in @yourtal/authz because a member carries it in an API payload; authz imports it and keeps the drift test against the Cerbos principal schema (YT-0509). Store staff are absent by design — they are device sessions, not members.",
    crossFieldRules: [],
  },
  {
    id: "Business",
    schema: businessSchema,
    description: "An advertiser, supplier and/or redeemer.",
    crossFieldRules: ["roles must not contain duplicates."],
  },
  {
    id: "BusinessMember",
    schema: businessMemberSchema,
    description:
      "A person's membership at one business (docs/17 section 2.1's six roles). NOT the Business-level `BusinessRole` above — this is the per-person team role, sourced from @yourtal/authz/roles so it cannot drift from the authorization model.",
    crossFieldRules: [],
  },
  {
    id: "BillingContact",
    schema: billingContactSchema,
    description:
      "The person a business's invoices and settlement statements are sent to (docs/17 section 2, Billing zone).",
    crossFieldRules: [],
  },
  {
    id: "KybDocumentType",
    schema: kybDocumentTypeSchema,
    description:
      "A category of Know-Your-Business document a business can submit during onboarding.",
    crossFieldRules: [],
  },
  {
    id: "KybDocumentStatus",
    schema: kybDocumentStatusSchema,
    description: "Review state of a submitted KYB document.",
    crossFieldRules: [],
  },
  {
    id: "KybDocument",
    schema: kybDocumentSchema,
    description:
      "A business's submitted KYB document and its review state (docs/17 section 5). `storageRef` is an opaque pointer to encrypted bytes; this schema does not cover the upload path itself.",
    crossFieldRules: [],
  },

  // --- questions ---
  {
    id: "QuestionOption",
    schema: questionOptionSchema,
    description: "One selectable answer.",
    crossFieldRules: [],
  },
  {
    id: "Question",
    schema: questionSchema,
    description:
      "A checkpoint question, discriminated on type. Variants are inlined rather than named as components because they are never referenced independently.",
    crossFieldRules: [
      "multiple_choice: correctOptionId must reference one of the provided options.",
      "likert: scaleMin must be less than scaleMax.",
    ],
  },
];
