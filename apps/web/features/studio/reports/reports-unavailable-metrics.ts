import type { BusinessRole } from "@yourtal/contracts/business";

export interface UnavailableMetric {
  id: string;
  /** The relationship a business needs to hold for this gap to even be relevant to them. `null` applies regardless. */
  requiresRelationship: BusinessRole | null;
}

/**
 * Every metric this codebase genuinely cannot report today. The copy
 * itself — `label`/`reason`, plain business language, no code paths,
 * endpoints or ticket IDs — lives in `studio.json`'s `reports.gaps.<id>`
 * (both locales), read by `reports-unavailable-panel.tsx` via
 * `getStudioTranslator`; this file only decides WHICH gaps apply to which
 * business relationship.
 *
 * Re-verified against `main` (not assumed) each time a gap here is
 * touched — a gap that becomes buildable, or gets built, is dropped from
 * this list rather than left to go stale. Two were dropped in that pass:
 * "question accuracy" (an aggregate is already computed and shown in the
 * campaign performance panel above) and "open vs rewarded views" (both are
 * now real, separately-floored numbers shown there too — kept apart on
 * purpose, but that is not the same thing as unavailable).
 *
 * `reports-screen.tsx` renders one `ReportsUnavailablePanel` per entry
 * whose `requiresRelationship` the current business actually holds (or
 * `null`), instead of a chart with invented numbers.
 */
export const UNAVAILABLE_METRICS: readonly UnavailableMetric[] = [
  { id: "completion-by-chapter", requiresRelationship: "advertiser" },
  { id: "campaign-redemption-attribution", requiresRelationship: "advertiser" },
];

/**
 * 12.3.e: NOT part of `UNAVAILABLE_METRICS` above — that list is for gaps
 * with no possible schema today. This one is a missing endpoint, not
 * missing data (a real, buildable next step — see `studio.json`'s own copy
 * for the plain-language version of why). `reports-screen.tsx` adds this to
 * its gap list only when `ReportsBundle.vouchers` is actually `undefined`
 * (live mode today), never in mock, where a real ledger exists.
 */
export const VOUCHER_LEDGER_GAP: UnavailableMetric = {
  id: "voucher-ledger-by-status",
  requiresRelationship: "supplier",
};
