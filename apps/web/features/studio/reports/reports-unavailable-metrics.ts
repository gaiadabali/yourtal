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
