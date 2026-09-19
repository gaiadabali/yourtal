import { z } from "zod";

/**
 * The closed list of purposes personal data may be processed for. YT-0036.
 *
 * ## Why this is an enum and not a string
 *
 * Indonesia's PDP Law requires purposes to be **specific and unambiguous**,
 * disclosed before collection. `docs/19` names the classic failure directly:
 * *"to improve our services"* is not a lawful purpose statement. An open
 * string field invites exactly that, and invites it at the moment someone is
 * shipping a feature and does not want to stop and think.
 *
 * So a purpose that is not on this list cannot be asked about, and adding one
 * is a deliberate act with a lawful basis attached (`purpose-catalogue.ts`)
 * rather than a string literal typed at a call site.
 *
 * ## Two distinctions that are load-bearing
 *
 * **Campaign questions and research questions are not the same purpose.**
 * `docs/01` §on survey framing: a business's questions gate the reward and
 * are disclosed as part of the deal; research questions are sold to a panel
 * buyer and need their own ESOMAR-grade disclosure and separate consent.
 * "Never let the second hide inside the first" — so they are two purposes
 * here, and no amount of consent to one grants the other.
 *
 * **Receipt data is its own purpose, not a flavour of targeting.**
 * `docs/16` D3 and `docs/19`: it is the moat and the biggest exposure, and a
 * pharmacy receipt implies health while a purchase pattern implies pregnancy,
 * religious observance or financial distress. `docs/19` item 4 is explicit
 * that it is a separate, opt-in, revocable consent and is not bundled into
 * signup.
 */
export const processingPurposeSchema = z.enum([
  // --- no consent needed: contract, legal obligation, or no personal data ---
  /** Issuing, tracking and honouring what the user earned. Contract. */
  "deliver_reward",
  /** Velocity caps, device clustering, enumeration defence. docs/14 §3. */
  "prevent_fraud",
  /** Retention, tax, regulator reporting. Legal obligation. */
  "comply_with_law",
  /** Ads matched to the content, not the person. No personal data involved. */
  "contextual_advertising",
  /** Cohort-level product metrics. Never resolves to an individual. */
  "aggregate_product_analytics",

  // --- consent required ---
  /** Targeting on interests the user themselves declared. docs/16 D3. */
  "declared_interest_targeting",
  /** Individual-level behavioural profiling. Opt-in tier, never default. */
  "behavioural_profiling",
  /** Targeting on snap-apps receipt data. Separate consent, docs/16 D3. */
  "purchase_history_targeting",
  /** Answers sold to a panel buyer. ESOMAR disclosure, docs/01. */
  "market_research_panel",
  /** Push, email and WhatsApp that is not about something they earned. */
  "marketing_communications",
  /** Sharing profile attributes with a sister app over YourtalID. */
  "sister_app_profile_sharing",
]);

export type ProcessingPurpose = z.infer<typeof processingPurposeSchema>;

/**
 * Why a purpose is lawful at all. Consent is only one of these, and treating
 * it as the only one is its own failure — asking for consent to something you
 * will do anyway (issue the voucher they earned) trains people to click
 * through, and makes the consent you actually need worthless.
 */
export const lawfulBasisSchema = z.enum([
  /** Necessary to do the thing the user asked for. No toggle. */
  "contract",
  /** Required by law or a regulator. No toggle. */
  "legal_obligation",
  /** No personal data is processed, so no basis is needed. No toggle. */
  "no_personal_data",
  /** Requires a specific, informed, revocable opt-in. */
  "consent",
]);

export type LawfulBasis = z.infer<typeof lawfulBasisSchema>;

/**
 * True when the purpose needs a consent record before it may proceed.
 *
 * A type predicate rather than a plain boolean so that `!requiresConsent(b)`
 * narrows `b` to the three bases that need no record — which is what lets
 * `consent-query.ts` return `{ type: basis }` without a cast and without the
 * compiler suspecting it might be building a consent basis with no version.
 */
export function requiresConsent(basis: LawfulBasis): basis is "consent" {
  return basis === "consent";
}
