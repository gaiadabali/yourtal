import { jurisdictionCodeSchema } from "@yourtal/jurisdiction/jurisdiction-code";
import { latestPerPurpose } from "./consent-record";
import type { ConsentRecord } from "./consent-record";
import { currentPolicyVersion } from "./policy-version";
import { definitionFor, isProhibitedIn } from "./purpose-catalogue";
import type { ConsentPhase } from "./purpose-catalogue";
import { requiresConsent } from "./purpose";
import type { ProcessingPurpose } from "./purpose";
import type { ConsentDecision } from "./decision";

/**
 * 12.1.c: "minors get declared interests only, never inferred ones."
 * `declared_interest_targeting` (the user's own chosen interests) stays
 * open to a teen; these two build a profile FROM their behaviour instead
 * (what they watch/click, or what snap-apps says they bought), which is
 * exactly the inference the rule forbids -- refused regardless of consent,
 * jurisdiction or phase, the same absolute shape `prohibitedIn` already
 * gives `behavioural_profiling` for AU.
 */
const MINORS_DECLARED_INTERESTS_ONLY: readonly ProcessingPurpose[] = [
  "behavioural_profiling",
  "purchase_history_targeting",
];

/**
 * "May I use this signal for X?" — YT-0036 AC2, and the only function any
 * other service should call.
 *
 * `docs/19` item 5: *"the consent service answers 'may I use this signal for
 * this purpose?' and the answer is load-bearing, not advisory."* Load-bearing
 * means no service reads a consent flag and decides for itself. There is
 * deliberately no exported way to fetch the raw records for a purpose — the
 * only thing on offer is the answer.
 *
 * ## The order of the checks IS the correctness argument
 *
 * Each step can only ever turn an allow into a deny, and the expensive
 * questions come last. Reordering this weakens it:
 *
 *   1. **Unknown purpose** -> deny. Not something we have a lawful basis
 *      statement for, so there is no basis to rely on.
 *   2. **Unknown jurisdiction** -> deny. We cannot know what is lawful.
 *   3. **Prohibited here** -> deny, BEFORE looking at consent. This is the
 *      step most implementations do not have. `docs/19`: *"with consent we
 *      can do anything"* is false — Australia's reform applies a "fair and
 *      reasonable" test **regardless of consent**, so a granted record must
 *      not be able to reach this decision. Checking consent first and this
 *      second would still return the right answer today, but it invites the
 *      next person to short-circuit on a cached grant.
 *   3.5. **Minors get declared interests only** -> deny, same shape as (3):
 *      a teen's own granted consent record must not be able to reach
 *      `behavioural_profiling`/`purchase_history_targeting` either — see
 *      `MINORS_DECLARED_INTERESTS_ONLY` above.
 *   4. **Phase gate** -> deny. `docs/16` D3 holds purchase-history targeting
 *      to Phase 2. Consent collected early does not advance the phase.
 *   5. **Lawful basis is not consent** -> allow. Asking permission for
 *      something we will do anyway (issuing the voucher they earned) trains
 *      people to click through and devalues the consent we actually need.
 *   6. **Consent record** -> the ordinary path: present, granted, and
 *      against the current policy version.
 *
 * Every failure mode resolves to a denial. There is no path through this
 * function that returns `allowed: true` because something could not be
 * determined.
 */
export interface ConsentQuery {
  readonly purpose: string;
  readonly jurisdiction: string;
  /**
   * The subject's consent records. Passing them in rather than fetching
   * keeps this package free of storage concerns and, more usefully, makes
   * every decision reproducible from its inputs in a test or an audit.
   */
  readonly records: readonly ConsentRecord[];
  /** Which phase the platform is in. `docs/16` D3 gates purposes on this. */
  readonly currentPhase: ConsentPhase;
  /**
   * 12.1.c: the subject's age band, when known. `undefined` (an anonymous
   * subject, or a caller that has not looked it up) does not restrict
   * anything here -- the minors-only refusal below can only ever narrow an
   * allow, never widen one, so a caller that omits it simply gets the same
   * answer this function always gave before this field existed.
   */
  readonly ageBand?: "teen" | "adult";
}

const PHASE_ORDER: readonly ConsentPhase[] = ["P1", "P2", "P3"];

export function mayUseSignalFor(query: ConsentQuery): ConsentDecision {
  // 1. Is this a purpose we have a lawful basis statement for at all?
  const definition = definitionFor(query.purpose);
  if (definition === undefined) {
    return { allowed: false, reason: { type: "unknown_purpose", purpose: query.purpose } };
  }

  // 2. Do we know what is lawful where this is happening?
  const jurisdiction = jurisdictionCodeSchema.safeParse(query.jurisdiction);
  if (!jurisdiction.success) {
    return {
      allowed: false,
      reason: { type: "unknown_jurisdiction", jurisdiction: query.jurisdiction },
    };
  }

  // 3. Unlawful here even with consent. Checked before any record is read.
  if (isProhibitedIn(definition, jurisdiction.data)) {
    return {
      allowed: false,
      reason: { type: "prohibited_in_jurisdiction", jurisdiction: jurisdiction.data },
    };
  }

  // 3.5. Same absolute shape as step 3: a minor's own inferred profile is
  // never on offer, so this is checked before any record is read too --
  // a granted consent record must not be able to reach this decision any
  // more than a granted one can override `prohibited_in_jurisdiction`.
  if (query.ageBand === "teen" && MINORS_DECLARED_INTERESTS_ONLY.includes(definition.purpose)) {
    return { allowed: false, reason: { type: "minors_declared_interests_only" } };
  }

  // 4. Have we earned the right to use this yet?
  if (!phaseReached(query.currentPhase, definition.availableFromPhase)) {
    return {
      allowed: false,
      reason: {
        type: "not_available_yet",
        availableFromPhase: definition.availableFromPhase,
        currentPhase: query.currentPhase,
      },
    };
  }

  // 5. Bases that are not consent need no record, and must not ask for one.
  if (!requiresConsent(definition.lawfulBasis)) {
    return { allowed: true, basis: { type: definition.lawfulBasis } };
  }

  // 6. The ordinary path.
  const version = currentPolicyVersion(jurisdiction.data);
  if (version === undefined) {
    // Unreachable while step 2 passed, but a missing version must never be
    // read as "no version required".
    return {
      allowed: false,
      reason: { type: "unknown_jurisdiction", jurisdiction: query.jurisdiction },
    };
  }

  const record = latestPerPurpose(query.records).get(`${definition.purpose}:${jurisdiction.data}`);
  if (record === undefined) {
    return { allowed: false, reason: { type: "consent_not_given" } };
  }
  if (record.state === "withdrawn") {
    return {
      allowed: false,
      reason: { type: "consent_withdrawn", withdrawnAt: record.recordedAt },
    };
  }
  if (record.policyVersionId !== version.id) {
    return {
      allowed: false,
      reason: {
        type: "consent_stale",
        consentedVersionId: record.policyVersionId,
        currentVersionId: version.id,
      },
    };
  }

  return { allowed: true, basis: { type: "consent", policyVersionId: version.id } };
}

function phaseReached(current: ConsentPhase, required: ConsentPhase): boolean {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(required);
}
