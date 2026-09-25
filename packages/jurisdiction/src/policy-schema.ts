import { z } from "zod";
import { kycTierSchema } from "./kyc-tier";

/**
 * The shape of one jurisdiction's regulated-feature switches — the single
 * source of truth AC1 of YT-0037 asks for. Every field traces to docs/03;
 * see the per-field comments below for the exact section.
 *
 * `.strict()` for the same reason as `packages/authz/src/principal.ts`: a
 * switch name the schema does not recognise is a typo or a half-finished
 * feature, and both should fail loudly at load rather than silently be
 * ignored. Adding a jurisdiction is adding a data object that satisfies this
 * schema (AC3); adding a SWITCH is editing this file, which is a reviewable,
 * intentional change, not a silent drift.
 *
 * No field is optional. AC2 ("fail closed") depends on every field being
 * present — an `.optional()` here would let a policy compile while quietly
 * omitting a switch, and the caller would have to guess what "absent" means.
 * `parseJurisdictionPolicy` below is the one place that guess is made, and it
 * always guesses restrictive.
 */
export const jurisdictionPolicySchema = z
  .object({
    /**
     * Whether points may be exchanged for cash in this jurisdiction.
     *
     * docs/03 §2.1 (Indonesia, BI Reg 10/2025 — PJP licensing, PT PMA,
     * IDR 15bn capital) and §3.1 (Australia, Corporations Act s911A — AFSL
     * or an exclusion). docs/24 positions ID-2 / AU-2 and red line #3 ("No
     * cash withdrawal, in either market, until licensed") both say the same
     * thing: this is off until a specific licensing project ships, and it is
     * never inferred from anything else.
     */
    cashOutEnabled: z.boolean(),

    /**
     * Whether a **user** may buy points with money. Red line #4, and it is
     * `z.literal(false)` rather than `z.boolean()` on purpose.
     *
     * ## Why this one cannot be a boolean
     *
     * Red line #3 reads "no cash withdrawal, in either market, **until
     * licensed**" — a prohibition with a condition, so a switch is the
     * honest type: one day a licensing project flips it. Red line #4 reads
     * "No user purchase of points. **Ever.**" There is no condition and no
     * project that ends it, because it is the single clearest e-money
     * indicator (docs/24 ID-1) and enabling it does not weaken that position,
     * it removes it.
     *
     * A `z.boolean()` here would model a decision that is not ours to make
     * as a configuration value someone could set. `z.literal(false)` makes
     * the prohibited state **unrepresentable**: a policy record with
     * `true` fails to parse, so it cannot reach a running system even if
     * someone writes it, reviews it and ships it.
     *
     * ## This is a voiding condition, which is why it is here at all
     *
     * YT-0012's counsel-substitution risk acceptance is **void rather than
     * expired** if red line 3 or 4 is crossed — those two are the premises
     * ID-1 and ID-2 rest on, so crossing either does not weaken the
     * acceptance, it removes the thing being accepted. Red line 3 was
     * enforced here and red line 4 was enforced by nothing, which meant the
     * acceptance could be voided **silently**: the signature stops being
     * valid and no signal anywhere says so. Found by the YT-0011 audit,
     * filed as YT-0602.
     *
     * Note this is about **users** buying points. A *partner* pre-purchasing
     * points to fund campaigns is the funding model (`ledger.point_purchase`,
     * YT-0046) and is untouched by this.
     */
    userPointPurchaseEnabled: z.literal(false),

    /**
     * Whether a chance-based prize draw may currently run.
     *
     * docs/03 §2.2 (Indonesia — MOSA Reg. 3/2024 draw + promotion permits,
     * 10% social-welfare contribution) and §3.3 (Australia — state permits
     * above published thresholds: NSW $10k, SA $5k, ACT $3k). docs/24 ID-4 /
     * AU-3. Skill-based mechanics need no permit anywhere and are therefore
     * not gated by this switch at all — see docs/03 §2.2 "skill-based games
     * need no draw permit". This switch governs only the chance-based path,
     * and defaults to off because a permit is a per-campaign lead-time item,
     * not a standing capability.
     */
    prizeDrawsEnabled: z.boolean(),

    /**
     * The minimum age, in years, to hold an account in this jurisdiction.
     *
     * docs/05-open-questions.md C4 flags this as unresolved product policy
     * ("Minimum age, and is there any under-18 experience? Children's
     * advertising rules and the AU privacy reform's child-protection
     * provisions make this a design decision, not a T&C line") — docs/03
     * itself does not publish a number for either market. The values in
     * `policy-data.ts` are therefore the conservative default (age of
     * majority, 18) pending that product/legal decision, not a cited legal
     * minimum; see this package's ticket report for that caveat.
     */
    minimumAgeYears: z.number().int().positive(),

    /**
     * The minimum age, in years, to hold an account WITH a parent or
     * guardian's consent — 1.4.b (TASKS.md), F4. Only reachable while
     * `apps/api`'s `TEEN_ACCOUNTS` flag is on (default false everywhere;
     * only 12.1 switches it on, and only for staging): with the flag off,
     * `minimumAgeYears` above is the only threshold that applies, and this
     * field is simply never asked about. Below this age there is no account
     * at any consent level (1.4.b: a neutral refusal, no age stated, the
     * date of birth discarded).
     */
    minimumAgeWithParentalConsentYears: z.number().int().positive(),

    /**
     * Whether a user must have their residency in this jurisdiction verified
     * before using jurisdiction-gated features.
     *
     * docs/03 §2.3 (PSE registration under PP 71/2019 is required "for any
     * platform serving Indonesian users" — the platform's obligations are
     * scoped to who it serves) and §3.1 (AU relief and AFSL exclusions are
     * tested against an Australian financial product for Australian users).
     * docs/03 §1 risk #5 ("country-isolated data planes") is the same
     * boundary from the privacy side. Each jurisdiction currently serves
     * only its own residents; this switch is how that design intent is
     * enforced rather than assumed.
     */
    residencyVerificationRequired: z.boolean(),

    /**
     * The minimum identity-verification strength required for a regulated
     * action in this jurisdiction. See `kyc-tier.ts` for the ladder.
     *
     * docs/03 §1 risk #3 (device-farm extraction, "now the top risk" on
     * web, mitigated by trust tiering) and docs/05 C6 (whether any KYC tier
     * is acceptable to users at all). Indonesia's NIK-bound SIM/e-wallet
     * anchor (docs/08 §2.1) makes a stronger tier cheap to ask for there.
     */
    minimumKycTier: kycTierSchema,
  })
  .strict();

export type JurisdictionPolicy = z.infer<typeof jurisdictionPolicySchema>;

/**
 * The answer when a jurisdiction is unknown or its policy record does not
 * parse — AC2. Every field is set to the most restrictive value a regulated
 * feature could see, never to whatever happens to be false/zero/off:
 *
 * - cash-out and prize draws: off (the restrictive value for an on/off
 *   switch is always off).
 * - minimum age: the higher of the two configured markets' ages, so a
 *   fallback never admits someone a real policy would have turned away.
 * - residency verification: required.
 * - KYC tier: `enhanced`, the strongest tier — requiring more verification
 *   is the restrictive direction, never less.
 *
 * This is a value, not a re-derivation, deliberately: it must keep working
 * even if `policy-data.ts` fails to parse, so it cannot be computed FROM
 * that data.
 */
export const RESTRICTIVE_FALLBACK_POLICY: JurisdictionPolicy = {
  cashOutEnabled: false,
  userPointPurchaseEnabled: false,
  prizeDrawsEnabled: false,
  minimumAgeYears: 21,
  minimumAgeWithParentalConsentYears: 21,
  residencyVerificationRequired: true,
  minimumKycTier: "enhanced",
};

/**
 * Parses one jurisdiction's policy data, falling back to the restrictive
 * default on anything that does not validate (AC2's "malformed policy data"
 * case). This is the ONLY place `policy-data.ts`'s literals are trusted to be
 * well-formed at runtime — `policy-data.ts` also runs its own literals
 * through this function, so a mistake in the checked-in data fails the same
 * way a mistake in a future dynamically-loaded override would.
 *
 * Deliberately total (never throws, never returns `undefined`): a policy
 * lookup sits upstream of every regulated feature check, and a thrown
 * exception here would need every call site to remember to catch it and
 * choose a safe default themselves. Returning the safe default directly
 * makes forgetting impossible.
 */
export function parseJurisdictionPolicy(raw: unknown): JurisdictionPolicy {
  const result = jurisdictionPolicySchema.safeParse(raw);
  return result.success ? result.data : RESTRICTIVE_FALLBACK_POLICY;
}
