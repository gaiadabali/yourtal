import type { FieldErrors, Resolver } from "react-hook-form";
import type { CampaignDraftFormValues } from "./campaign-draft";
import { validateCampaignDraftForm } from "./campaign-draft";

/**
 * Adapts the plain-function validator in `campaign-draft.ts` into React Hook
 * Form's `resolver` shape — the same interface `zodResolver` fills, without
 * needing a Zod schema at runtime (YT-0525).
 *
 * `/business/campaigns` measured at 186.8 KB gz against the 200 KB hard gate
 * before this ticket, ~13 KB of headroom — and this file's whole reason to
 * exist is that `zodResolver` needs a Zod schema to hand it, which is
 * exactly what an earlier ticket removed from this route (see
 * `campaign-draft.ts`'s doc comment: `zod/mini`'s shared parsing core alone
 * cost ~20 KB gz here, for four trivial checks). A `Resolver` does not have
 * to come from a schema library, though — RHF's own type is just
 * `(values) => { values, errors }`, and any function shaped that way
 * qualifies. So the four `if` statements keep driving validation exactly as
 * before, and React Hook Form only adds what it actually offers on top —
 * per-field `formState.errors`, `isDirty`/`touchedFields`, `onChange`-mode
 * revalidation — at zero extra runtime-parsing cost. `zodResolver` is not
 * used here; if this schema ever needs the richer composability a real Zod
 * shape gives (refinements, `.and()`, shared cross-form pieces),
 * revisit — a four-field scalar form is not that case yet.
 *
 * Measured outcome (this ticket, `node scripts/perf-check-bundle-size.mjs`):
 * React Hook Form itself — `useForm`/`register`/`formState`, no
 * `@hookform/resolvers`, no Zod — cost ~10.8 KB gz on this route: 186.8 KB
 * before, 197.6 KB after. That is under the 200 KB hard gate but leaves
 * only ~2.4 KB of headroom, which is why this migration stops at the
 * campaign-draft form and does not extend to `question-bank`'s
 * `question-editor.tsx` — a second `useForm` there would add component
 * code on top of an already-paid-for library with almost no budget left to
 * absorb it. `question-bank`'s hand-built fields stay as they are for the
 * same reason `campaign-draft.ts`'s validator stayed hand-rolled: flagged,
 * not hidden. See this ticket's report for the full before/after table.
 */
export const campaignDraftFormResolver: Resolver<CampaignDraftFormValues> = (values) => {
  const fieldErrors = validateCampaignDraftForm(values);
  const entries = Object.entries(fieldErrors);
  if (entries.length === 0) {
    return { values, errors: {} };
  }
  const errors = Object.fromEntries(
    entries.map(([field, message]) => [field, { type: "validate", message }]),
  ) as FieldErrors<CampaignDraftFormValues>;
  return { values: {}, errors };
};
