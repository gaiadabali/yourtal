import type { BusinessRole } from "@yourtal/contracts/business";

export interface UnavailableMetric {
  id: string;
  label: string;
  /** The relationship a business needs to hold for this gap to even be relevant to them. `null` applies regardless. */
  requiresRelationship: BusinessRole | null;
  reason: string;
}

/**
 * Every metric YT-0443's brief names that this codebase genuinely cannot
 * report today, and exactly why — named per file/field, not a generic
 * "coming soon". The instruction this file exists to satisfy: "if there is
 * no ledger or event contract for something ... derive it visibly from
 * what exists and say so in code, or leave the panel out. A
 * plausible-looking fabricated chart is worse than an empty state."
 *
 * `reports-screen.tsx` renders one `ReportsUnavailablePanel` per entry
 * whose `requiresRelationship` the current business actually holds (or
 * `null`), instead of a chart with invented numbers.
 */
export const UNAVAILABLE_METRICS: readonly UnavailableMetric[] = [
  {
    id: "completion-by-chapter",
    label: "Completion by chapter",
    requiresRelationship: "advertiser",
    reason:
      "campaignSchema (@yourtal/contracts/campaign) carries no chapter data at all. Chapters shown in the player are derived client-side for display only, from durationSeconds (features/player/derive-chapters.ts), and no attendance or drop-off is recorded against them anywhere. There is no history/analytics contract in packages/contracts this could be read from.",
  },
  {
    id: "question-accuracy-recall",
    label: "Question accuracy & recall score",
    requiresRelationship: "advertiser",
    reason:
      "The question bank defines prompts and correct answers, but no schema anywhere records what a viewer actually answered. Without a response/attempt record, accuracy and recall cannot be computed — only guessed, which would be worse than showing nothing.",
  },
  {
    id: "campaign-redemption-attribution",
    label: "Redemption attribution to a campaign",
    requiresRelationship: "advertiser",
    reason:
      "A voucher records which business it belongs to, but not which campaign's view earned it. This zone can attribute a voucher to this business (see the redemption ledger below), but not to the specific campaign that drove it.",
  },
  {
    id: "open-vs-rewarded-views",
    label: "Open views vs rewarded views",
    requiresRelationship: "advertiser",
    reason:
      "No view or watch-session event record exists yet — not for anonymous Open Viewing, nor for signed-in rewarded views. Both counts, and therefore any ratio or total between them, are unavailable rather than fabricated. Kept as two separate, never-summed entries here on purpose, so the distinction stays structural even while both numbers are absent.",
  },
];

/**
 * 12.3.e: NOT part of `UNAVAILABLE_METRICS` above — that list is for gaps
 * with no possible schema today (an inherently missing field or record).
 * This one is a missing ENDPOINT, not missing data: `GET
 * .../studio/redemptions` (8.2.g) already lists this business's own
 * capture events, but nothing returns its full voucher ledger broken down
 * by status (active/redeemed/expired/transferred) with a face-value total
 * per status — the Reports zone's redemption-ledger panel needs. Building
 * one is a real, buildable next step, just not this pass's — flagged for
 * the architect rather than invented client-side. `reports-screen.tsx`
 * adds this to its gap list only when `ReportsBundle.vouchers` is actually
 * `undefined` (live mode today), never in mock, where a real ledger exists.
 */
export const VOUCHER_LEDGER_GAP: UnavailableMetric = {
  id: "voucher-ledger-by-status",
  label: "Vouchers by status (active, redeemed, expired, transferred)",
  requiresRelationship: "supplier",
  reason:
    "No merchant-facing endpoint returns this business's own voucher ledger broken down by status yet. GET /api/:tenantId/studio/redemptions (8.2.g) exists but only lists this business's own capture events (vouchers already redeemed at one of its own devices, shown in the separate Redemptions zone) — active, expired and transferred vouchers are never captured, so nothing here can report on them without a new endpoint.",
};
