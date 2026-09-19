import { z } from "zod";
import { jurisdictionCodeSchema } from "@yourtal/jurisdiction/jurisdiction-code";
import { processingPurposeSchema } from "./purpose";

/**
 * One person's answer to one purpose, at one policy version. YT-0036 AC1.
 *
 * ## Append-only, and why the shape says so
 *
 * There is no `granted: boolean` to flip. A record is `granted` or
 * `withdrawn`, it carries when and from where, and a withdrawal is a NEW
 * record rather than an edit to the old one. `docs/14` §8 puts audit logs as
 * append-only and hash-chained for the same reason this is: the question a
 * regulator asks is not "do they consent now" but **"what were you relying
 * on when you processed that, and can you show it"**. A mutable flag cannot
 * answer that, and the moment it is overwritten the evidence is gone.
 *
 * `grantedAt` is therefore the time of THIS record, not the first time they
 * ever agreed. The history is the sequence.
 *
 * ## `source` is not decoration
 *
 * ID's PDP Law and AU's Privacy Act both require consent to be informed and
 * freely given. If a record cannot say where it came from, it cannot show
 * that. `import_from_sister_app` exists and is deliberately the weakest:
 * consent given to snap-apps is not automatically consent given to us
 * (`docs/05` F4 asks that exact question and it is still open), so a record
 * with that source should be treated as a claim to verify, not a grant.
 */
export const consentSourceSchema = z.enum([
  /** The Me surface's per-purpose toggles. docs/17 §3. */
  "settings_toggle",
  /** The consent step during signup. */
  "onboarding",
  /** A just-in-time prompt at the point the purpose first applies. */
  "contextual_prompt",
  /** The YourtalID scope consent screen for a sister app. docs/02 §8. */
  "oidc_consent_screen",
  /** Carried over from a sister app. Weakest: verify before relying on it. */
  "import_from_sister_app",
]);

export type ConsentSource = z.infer<typeof consentSourceSchema>;

export const consentStateSchema = z.enum(["granted", "withdrawn"]);
export type ConsentState = z.infer<typeof consentStateSchema>;

export const consentRecordSchema = z
  .object({
    userId: z.uuid(),
    purpose: processingPurposeSchema,
    jurisdiction: jurisdictionCodeSchema,
    /**
     * The policy version the person was shown. A record against a
     * superseded material version no longer counts — see
     * `policy-version.ts` for why that cost is deliberate.
     */
    policyVersionId: z.string().min(1),
    state: consentStateSchema,
    /** RFC3339. When THIS record was written, not when they first agreed. */
    recordedAt: z.iso.datetime({ offset: true }),
    source: consentSourceSchema,
  })
  .strict();

export type ConsentRecord = z.infer<typeof consentRecordSchema>;

/**
 * The most recent record for each purpose, which is the only one that
 * decides anything. Ties break toward the LAST element, so a caller passing
 * records in write order gets the newest — and toward `withdrawn` when two
 * records share a timestamp, because a withdrawal racing a grant must not
 * resolve to "allowed".
 */
export function latestPerPurpose(
  records: readonly ConsentRecord[],
): ReadonlyMap<string, ConsentRecord> {
  const latest = new Map<string, ConsentRecord>();
  for (const record of records) {
    const key = `${record.purpose}:${record.jurisdiction}`;
    const existing = latest.get(key);
    if (existing === undefined || supersedes(record, existing)) {
      latest.set(key, record);
    }
  }
  return latest;
}

function supersedes(candidate: ConsentRecord, existing: ConsentRecord): boolean {
  if (candidate.recordedAt > existing.recordedAt) return true;
  if (candidate.recordedAt < existing.recordedAt) return false;
  // Same instant: a withdrawal wins. Two records at one timestamp is a clock
  // or import artefact, and resolving it toward "allowed" would be the one
  // direction that cannot be undone after the data has been used.
  return candidate.state === "withdrawn";
}
