import type { PolicyDecision, PolicyDenyReason } from "./decision";
import type { KycTier } from "./kyc-tier";
import { satisfiesKycTier } from "./kyc-tier";
import { resolvePolicy } from "./policy-data";

/**
 * The jurisdiction policy service's public surface — AC4. Every regulated
 * feature asks one of these questions; none of them read a switch and
 * interpret it themselves (that is precisely what `policies/README.md`
 * calls out as the failure mode a real PDP avoids: "a rule written once and
 * tested here covers all of them; a check written per endpoint covers the
 * endpoints someone remembered"). A caller that wants to know whether
 * cash-out is available calls `mayCashOut`, not
 * `getPolicy(jurisdiction).cashOutEnabled`  — there is no exported function
 * that returns the raw switch bag, on purpose.
 *
 * These functions are synchronous and never throw: `resolvePolicy` already
 * collapses "unknown jurisdiction" and "malformed data" into the restrictive
 * fallback (AC2), so there is no exceptional path left for a caller to
 * mishandle. That is also why this module does not use `neverthrow`'s
 * `Result` (docs/13b §4 governs EXPECTED FAILURES; being denied is not a
 * failure of this service, it is the correct, everyday answer to the
 * question asked) — see `decision.ts`'s header for the same point made
 * about `PolicyDecision` versus `AuthzError`.
 */

function allow(): PolicyDecision {
  return { allowed: true };
}

function deny(reason: PolicyDenyReason): PolicyDecision {
  return { allowed: false, reason };
}

/** Is cash-out currently switched on for this jurisdiction? docs/03 §2.1, §3.1. */
export function mayCashOut(jurisdiction: string): PolicyDecision {
  const policy = resolvePolicy(jurisdiction);
  if (!isKnownJurisdiction(jurisdiction)) {
    return deny({ type: "unknown_jurisdiction", jurisdiction });
  }
  return policy.cashOutEnabled
    ? allow()
    : deny({ type: "feature_disabled", switchName: "cashOutEnabled" });
}

/** May a chance-based prize draw run right now in this jurisdiction? docs/03 §2.2, §3.3. */
export function mayRunPrizeDraw(jurisdiction: string): PolicyDecision {
  const policy = resolvePolicy(jurisdiction);
  if (!isKnownJurisdiction(jurisdiction)) {
    return deny({ type: "unknown_jurisdiction", jurisdiction });
  }
  return policy.prizeDrawsEnabled
    ? allow()
    : deny({ type: "feature_disabled", switchName: "prizeDrawsEnabled" });
}

/**
 * Does this age satisfy the jurisdiction's minimum to hold an account?
 * docs/05 C4 — see `policy-schema.ts` for the caveat on where the number
 * itself comes from.
 */
export function meetsMinimumAge(jurisdiction: string, ageYears: number): PolicyDecision {
  const policy = resolvePolicy(jurisdiction);
  if (!isKnownJurisdiction(jurisdiction)) {
    return deny({ type: "unknown_jurisdiction", jurisdiction });
  }
  return ageYears >= policy.minimumAgeYears
    ? allow()
    : deny({
        type: "below_minimum_age",
        requiredYears: policy.minimumAgeYears,
        actualYears: ageYears,
      });
}

/**
 * Does this age satisfy the jurisdiction's minimum to hold an account WITH a
 * parent or guardian's consent (F4, 1.4.b)? Only meaningful while
 * `apps/api`'s `TEEN_ACCOUNTS` flag is on — that flag lives outside this
 * package (it is a rollout switch, not a jurisdiction fact), so a caller with
 * the flag off should keep asking `meetsMinimumAge` instead of this.
 */
export function meetsMinimumAgeWithParentalConsent(
  jurisdiction: string,
  ageYears: number,
): PolicyDecision {
  const policy = resolvePolicy(jurisdiction);
  if (!isKnownJurisdiction(jurisdiction)) {
    return deny({ type: "unknown_jurisdiction", jurisdiction });
  }
  return ageYears >= policy.minimumAgeWithParentalConsentYears
    ? allow()
    : deny({
        type: "below_minimum_age",
        requiredYears: policy.minimumAgeWithParentalConsentYears,
        actualYears: ageYears,
      });
}

/** Has this subject's residency in the jurisdiction been verified, if required? docs/03 §2.3, §3.1. */
export function meetsResidencyRequirement(
  jurisdiction: string,
  isResidencyVerified: boolean,
): PolicyDecision {
  const policy = resolvePolicy(jurisdiction);
  if (!isKnownJurisdiction(jurisdiction)) {
    return deny({ type: "unknown_jurisdiction", jurisdiction });
  }
  if (!policy.residencyVerificationRequired) {
    return allow();
  }
  return isResidencyVerified ? allow() : deny({ type: "residency_unverified" });
}

/** Does this subject's KYC tier meet the jurisdiction's minimum? docs/03 §1 risk #3, docs/05 C6. */
export function meetsKycTier(jurisdiction: string, heldTier: KycTier): PolicyDecision {
  const policy = resolvePolicy(jurisdiction);
  if (!isKnownJurisdiction(jurisdiction)) {
    return deny({ type: "unknown_jurisdiction", jurisdiction });
  }
  return satisfiesKycTier(heldTier, policy.minimumKycTier)
    ? allow()
    : deny({
        type: "kyc_tier_insufficient",
        requiredTier: policy.minimumKycTier,
        heldTier,
      });
}

/**
 * `resolvePolicy` already folds "unknown" into the restrictive fallback, so
 * every question function above needs its own check to report WHICH deny
 * reason applies (unknown jurisdiction vs. a real switch being off) rather
 * than reporting every unknown jurisdiction as if cash-out were merely
 * disabled there. Kept private: callers ask questions, they do not validate
 * jurisdiction codes themselves.
 */
function isKnownJurisdiction(jurisdiction: string): boolean {
  return jurisdiction === "ID" || jurisdiction === "AU";
}
