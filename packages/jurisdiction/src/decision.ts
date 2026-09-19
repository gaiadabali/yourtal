import type { KycTier } from "./kyc-tier";

/**
 * The answer to a jurisdiction policy question — AC4's "query API, not a
 * flag bag". Mirrors `packages/authz/src/decision.ts`'s reasoning: a caller
 * gets a decision, not a boolean it has to interpret, and a denial always
 * carries WHY, the same way Cerbos's PDP does. Unlike `AuthzError`, a denial
 * here is not modelled as a `neverthrow` error — being turned away is the
 * everyday, expected shape of a policy answer (an unverified 16-year-old
 * asking to redeem is not an exceptional condition), not a failure the
 * caller "handles" as opposed to obeys. See `policy-query.ts`'s header for
 * why this stays a plain discriminated union instead of a `Result`.
 */
export type PolicyDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: PolicyDenyReason };

/**
 * Why a policy question was answered no, as a discriminated union on `type`
 * (docs/13b §4) — never a bare string. `unknown_jurisdiction` and
 * `policy_unavailable` are the two AC2 fail-closed paths surfacing through
 * every question function uniformly, because `resolvePolicy` is the one
 * place that resolution happens.
 */
export type PolicyDenyReason =
  /** The jurisdiction code was not one this package has policy data for. */
  | { readonly type: "unknown_jurisdiction"; readonly jurisdiction: string }
  /** The named switch is off for this jurisdiction. */
  | { readonly type: "feature_disabled"; readonly switchName: string }
  /** The subject's age is below the jurisdiction's minimum. */
  | {
      readonly type: "below_minimum_age";
      readonly requiredYears: number;
      readonly actualYears: number;
    }
  /** The subject's residency in this jurisdiction has not been verified. */
  | { readonly type: "residency_unverified" }
  /** The subject's KYC tier does not meet the jurisdiction's minimum. */
  | {
      readonly type: "kyc_tier_insufficient";
      readonly requiredTier: KycTier;
      readonly heldTier: KycTier;
    };

/** Renders a `PolicyDenyReason` for a log line. Never shown to an end user. */
export function describePolicyDenyReason(reason: PolicyDenyReason): string {
  switch (reason.type) {
    case "unknown_jurisdiction":
      return `unknown jurisdiction: ${reason.jurisdiction}`;
    case "feature_disabled":
      return `feature disabled: ${reason.switchName}`;
    case "below_minimum_age":
      return `below minimum age: required ${String(reason.requiredYears)}, actual ${String(reason.actualYears)}`;
    case "residency_unverified":
      return "residency unverified";
    case "kyc_tier_insufficient":
      return `kyc tier insufficient: required ${reason.requiredTier}, held ${reason.heldTier}`;
    default: {
      // Adding a variant must break every consumer at compile time (docs/13b §4).
      const unreachable: never = reason;
      return String(unreachable);
    }
  }
}
