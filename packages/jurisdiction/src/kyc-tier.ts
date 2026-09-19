import { z } from "zod";

/**
 * Identity-verification strength, ordered weakest to strongest.
 *
 * docs/03 §1 risk #3 names device-farm reward extraction as the platform's
 * top risk, and its mitigation list (phone OTP, WebAuthn passkeys, trust
 * tiering) is exactly this ladder. docs/08 §2.1's "payout-instrument
 * uniqueness" and docs/05 C6 ("is any identity verification acceptable to
 * users at any tier?") are the two open questions this tier answers per
 * jurisdiction, one number rather than a scattered set of booleans.
 *
 * - `none` — anonymous or phone-only, no verified identity.
 * - `basic` — phone OTP anchor (docs/03 §1 risk #3).
 * - `verified` — WebAuthn passkey bound, required before high-value
 *   redemption (docs/14 §5, referenced from `packages/authz/src/principal.ts`
 *   `hasPasskey`).
 * - `enhanced` — a KYC'd, NIK-bound payout instrument linked (docs/08 §2.1).
 *   The strongest anchor available; also the RESTRICTIVE fallback value,
 *   because "require the most verification" is always the safe failure mode.
 */
export const kycTierSchema = z.enum(["none", "basic", "verified", "enhanced"]);

export type KycTier = z.infer<typeof kycTierSchema>;

/** Ascending strength order. Index is the rank; higher rank is stronger. */
const KYC_TIER_ORDER: readonly KycTier[] = ["none", "basic", "verified", "enhanced"];

function rankOf(tier: KycTier): number {
  const index = KYC_TIER_ORDER.indexOf(tier);
  // Invariant: `tier` is typed as `KycTier`, so it is one of the four
  // literals above and `indexOf` cannot return -1.
  return index;
}

/** True when `held` satisfies a `required` tier — i.e. is at least as strong. */
export function satisfiesKycTier(held: KycTier, required: KycTier): boolean {
  return rankOf(held) >= rankOf(required);
}
