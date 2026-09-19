import type { ConsentPhase } from "./purpose-catalogue";

/**
 * The answer to "may I use this signal for X?" — YT-0036 AC2.
 *
 * A decision, not a boolean, for the same reason `@yourtal/jurisdiction` and
 * the Cerbos PDP return one: a caller should obey an answer, not interpret a
 * flag. And a denial always carries WHY, because the four reasons below need
 * four different responses from the product — `consent_not_given` means show
 * the toggle, `prohibited_in_jurisdiction` means never show it, and treating
 * those the same is how a prompt appears in a market where the answer can
 * only ever be no.
 *
 * Not a `neverthrow` Result: being told no is the everyday shape of this
 * answer, not an exceptional condition. The fail-closed paths
 * (`unknown_purpose`, `unknown_jurisdiction`) come back as ordinary denials
 * for the same reason — a caller must not be able to distinguish "we could
 * not work it out" from "no" and then treat the first as permission.
 */
export type ConsentDecision =
  | { readonly allowed: true; readonly basis: ConsentAllowBasis }
  | { readonly allowed: false; readonly reason: ConsentDenyReason };

/** Why a use was permitted. Logged, so the basis relied on is on the record. */
export type ConsentAllowBasis =
  /** Necessary to deliver what the user asked for. No consent needed. */
  | { readonly type: "contract" }
  /** Required by law. No consent needed. */
  | { readonly type: "legal_obligation" }
  /** No personal data is processed, so no basis is required. */
  | { readonly type: "no_personal_data" }
  /** A current, granted consent record. Carries the version relied on. */
  | { readonly type: "consent"; readonly policyVersionId: string };

export type ConsentDenyReason =
  /** Not a purpose this package knows. Fail closed; never allow. */
  | { readonly type: "unknown_purpose"; readonly purpose: string }
  /** Not a jurisdiction this package has policy for. Fail closed. */
  | { readonly type: "unknown_jurisdiction"; readonly jurisdiction: string }
  /**
   * Unlawful here EVEN WITH CONSENT — Australia's fair-and-reasonable test
   * (docs/03 §3.2, docs/19). The product must not offer a toggle for this;
   * there is nothing the user could do to make the answer yes.
   */
  | { readonly type: "prohibited_in_jurisdiction"; readonly jurisdiction: string }
  /** Not available until a later phase. docs/16 D3. */
  | {
      readonly type: "not_available_yet";
      readonly availableFromPhase: ConsentPhase;
      readonly currentPhase: ConsentPhase;
    }
  /** No record at all. The honest default for anything consent-based. */
  | { readonly type: "consent_not_given" }
  /** They said yes and then said no. */
  | { readonly type: "consent_withdrawn"; readonly withdrawnAt: string }
  /**
   * They consented to wording that has since changed materially, so the
   * agreement was to a different thing. Ask again; do not assume.
   */
  | {
      readonly type: "consent_stale";
      readonly consentedVersionId: string;
      readonly currentVersionId: string;
    };

/** Renders a denial for a log line. Never shown to an end user as-is. */
export function describeConsentDenyReason(reason: ConsentDenyReason): string {
  switch (reason.type) {
    case "unknown_purpose":
      return `unknown purpose "${reason.purpose}"`;
    case "unknown_jurisdiction":
      return `unknown jurisdiction "${reason.jurisdiction}"`;
    case "prohibited_in_jurisdiction":
      return `prohibited in ${reason.jurisdiction} regardless of consent`;
    case "not_available_yet":
      return `not available until ${reason.availableFromPhase} (current ${reason.currentPhase})`;
    case "consent_not_given":
      return "no consent record";
    case "consent_withdrawn":
      return `consent withdrawn at ${reason.withdrawnAt}`;
    case "consent_stale":
      return `consent was given against ${reason.consentedVersionId}, current is ${reason.currentVersionId}`;
    default: {
      // Adding a reason must break every consumer at compile time.
      const unreachable: never = reason;
      return String(unreachable);
    }
  }
}
