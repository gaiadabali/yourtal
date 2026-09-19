import { z } from "zod";
import { jurisdictionCodeSchema } from "@yourtal/jurisdiction/jurisdiction-code";
import type { JurisdictionCode } from "@yourtal/jurisdiction/jurisdiction-code";

/**
 * Versioned consent policy text, per jurisdiction. YT-0036 AC1.
 *
 * ## Why consent is tied to a version at all
 *
 * Consent is to a **specific, disclosed purpose** — Indonesia's PDP Law
 * requires the purpose to be specific and unambiguous and disclosed before
 * collection (`docs/19`). If the wording of what someone agreed to changes
 * materially, their old agreement was to a different thing, and continuing
 * to rely on it is the quiet way a consent record becomes a fiction.
 *
 * So a consent record stores the version it was given against, and
 * `consent-query.ts` refuses a record whose version is no longer current.
 * The cost is real — a material re-wording invalidates live consent and the
 * user has to be asked again — and that cost is the point. It makes
 * "material" a decision someone takes deliberately rather than a judgement
 * buried in a copy edit.
 *
 * `editorial` bumps exist for exactly that reason: fixing a typo or
 * translating a sentence better should NOT log everyone out of their
 * consent. Only `material` bumps do.
 *
 * ## The date to design against
 *
 * `docs/03` §2.3: Indonesia's GR 33/2026 takes effect **16 January 2027**,
 * and it is named there as a hard date to design the consent service
 * against. Whatever the ID policy text says on that date has to satisfy it,
 * which is why the version carries an effective date rather than only an
 * ordinal.
 */
export const policyVersionSchema = z
  .object({
    /** Monotonic per jurisdiction, e.g. "id-2026-09-01". Opaque to callers. */
    id: z.string().min(1),
    jurisdiction: jurisdictionCodeSchema,
    /** RFC3339. When this wording became the one people agree to. */
    effectiveFrom: z.iso.datetime({ offset: true }),
    /**
     * `material` invalidates existing consent; `editorial` does not. There
     * is no third option on purpose — "minor but arguably material" is the
     * category that lets a real change through unnoticed.
     */
    changeKind: z.enum(["material", "editorial"]),
  })
  .strict();

export type PolicyVersion = z.infer<typeof policyVersionSchema>;

/**
 * The current policy version per jurisdiction.
 *
 * Placeholder wording ids until YT-0015 (consumer-facing legal copy, drafted
 * per jurisdiction in Bahasa and English) lands. The SHAPE is what this
 * package needs to be correct about now; the text is YT-0015's job, and
 * `docs/19` item 1 requires it in plain Bahasa and English, not only English.
 */
const CURRENT: Readonly<Record<JurisdictionCode, PolicyVersion>> = {
  ID: policyVersionSchema.parse({
    id: "id-2026-09-01",
    jurisdiction: "ID",
    effectiveFrom: "2026-09-01T00:00:00Z",
    changeKind: "material",
  }),
  AU: policyVersionSchema.parse({
    id: "au-2026-09-01",
    jurisdiction: "AU",
    effectiveFrom: "2026-09-01T00:00:00Z",
    changeKind: "material",
  }),
};

/**
 * The version a consent record must match to still count.
 *
 * Takes a raw string rather than the narrowed code so that an unrecognised
 * jurisdiction returns `undefined` and the caller denies, instead of
 * throwing somewhere upstream of a decision that should simply be "no".
 */
export function currentPolicyVersion(jurisdiction: string): PolicyVersion | undefined {
  const parsed = jurisdictionCodeSchema.safeParse(jurisdiction);
  return parsed.success ? CURRENT[parsed.data] : undefined;
}
