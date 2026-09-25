import { jurisdictionCodeSchema, type JurisdictionCode } from "./jurisdiction-code";
import {
  RESTRICTIVE_FALLBACK_POLICY,
  parseJurisdictionPolicy,
  type JurisdictionPolicy,
} from "./policy-schema";

/**
 * The two jurisdictions, as DATA — AC3. Each object below is a plain
 * literal, not logic; adding a third jurisdiction means adding a third
 * entry here (and to `jurisdiction-code.ts`'s enum) and nothing else in this
 * package needs to change. Every literal is run through
 * `parseJurisdictionPolicy` before it is exposed, so a typo here fails the
 * same way a malformed dynamically-loaded policy would (see that function's
 * comment) rather than being trusted just because it is checked into git.
 *
 * Per-field regulatory citations live on `jurisdictionPolicySchema` in
 * `policy-schema.ts`, once, rather than repeated per jurisdiction here.
 */
const RAW_POLICIES: Record<JurisdictionCode, unknown> = {
  ID: {
    // docs/03 §2.1, docs/24 ID-2, red line #3 — no cash-out until PJP-licensed.
    cashOutEnabled: false,
    // docs/24 red line #4 and ID-1 - users may never buy points. Typed
    // z.literal(false), so true cannot parse. See policy-schema.ts.
    userPointPurchaseEnabled: false,
    // docs/03 §2.2 — no standing draw permit; enabled only per permitted campaign.
    prizeDrawsEnabled: false,
    // docs/05 C4 — no published legal minimum; conservative default pending sign-off.
    minimumAgeYears: 18,
    // F4 (2026-09-25): 13-17 with parental consent, only while TEEN_ACCOUNTS
    // is on (default false everywhere; staging only, pending counsel — 12.4).
    minimumAgeWithParentalConsentYears: 13,
    // docs/03 §2.3 — PSE registration scopes the platform to Indonesian users.
    residencyVerificationRequired: true,
    // docs/03 §1 risk #3 — device-farm extraction is the top risk on web; the
    // NIK-bound SIM/e-wallet anchor (docs/08 §2.1) makes a stronger tier cheap.
    minimumKycTier: "verified",
  },
  AU: {
    // docs/03 §3.1, docs/24 AU-2, red line #3 — AFSL/relief line not crossed.
    cashOutEnabled: false,
    // docs/24 red line #4 and ID-1 - users may never buy points. Typed
    // z.literal(false), so true cannot parse. See policy-schema.ts.
    userPointPurchaseEnabled: false,
    // docs/03 §3.3 — state permits (NSW/ACT/SA/NT) are per-promotion, not standing.
    prizeDrawsEnabled: false,
    // docs/05 C4 — no published legal minimum; conservative default pending sign-off.
    minimumAgeYears: 18,
    // F4 (2026-09-25): 13-17 with parental consent, only while TEEN_ACCOUNTS
    // is on (default false everywhere; staging only, pending counsel — 12.4).
    minimumAgeWithParentalConsentYears: 13,
    // docs/03 §3.1 / §1 risk #5 — AU relief tested against Australian users/product.
    residencyVerificationRequired: true,
    // docs/03 §1 risk #3 — no NIK-equivalent anchor available; phone OTP baseline.
    minimumKycTier: "basic",
  },
};

/**
 * The parsed, trustworthy policy table. Built once at module load — this is
 * the "environment variables at startup, failing fast" pattern from docs/13b
 * §3, except that a malformed entry here resolves to the restrictive default
 * rather than crashing the process, per AC2 (see `parseJurisdictionPolicy`).
 */
export const JURISDICTION_POLICIES: Readonly<Record<JurisdictionCode, JurisdictionPolicy>> = {
  ID: parseJurisdictionPolicy(RAW_POLICIES.ID),
  AU: parseJurisdictionPolicy(RAW_POLICIES.AU),
};

/**
 * Looks up the policy for a jurisdiction that has not yet been validated as
 * one of the known codes — AC2's "unknown jurisdiction" case. Takes `string`
 * rather than `JurisdictionCode` on purpose: `Principal.attr.jurisdiction` is
 * already narrowed by the time it reaches most callers, but this package
 * must not assume that. A code that fails `jurisdictionCodeSchema` (a typo,
 * a jurisdiction added to some upstream enum before it has policy data here,
 * anything) resolves to the same restrictive fallback as malformed data,
 * never to a permissive guess.
 */
export function resolvePolicy(jurisdiction: string): JurisdictionPolicy {
  const parsed = jurisdictionCodeSchema.safeParse(jurisdiction);
  if (!parsed.success) {
    return RESTRICTIVE_FALLBACK_POLICY;
  }
  return JURISDICTION_POLICIES[parsed.data];
}
