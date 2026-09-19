"use client";

import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";
import { Button } from "@yourtal/ui/button";
import { useRegion } from "@/features/region/use-region";
import { getStreakTranslator } from "./streak-i18n";
import { StreakLadder } from "./streak-ladder";
import { useStreak } from "./use-streak";

/**
 * Daily check-in card (YT-0177), on the Earn board per docs/17-surfaces-
 * and-roles.md §1.1's own analogy: "the right analogues are ... an
 * offerwall, and Duolingo — a bright, dense board of things to do ... plus
 * a streak and a clear 'do this next.'"
 *
 * Deliberately NOT wired to any wallet balance or points ledger — see
 * `streak-state.ts`'s doc comment for exactly why (no faucet endpoint
 * exists) and `fundingNote` below, which states the honest position
 * rather than a silent one: this schedules and locally tracks a streak,
 * it does not itself move a single point. Ticket YT-0177's "funded from
 * the reserve like any other faucet" acceptance criterion is a ledger
 * guarantee this frontend-only implementation cannot provide or fake —
 * flagged in the ticket report per instruction, not built around here.
 */
export function StreakCheckInCard() {
  const { locale } = useRegion();
  const { streakLength, cycleDay, hasCheckedInToday, todaysReward, handleCheckIn } = useStreak();
  const t = getStreakTranslator(locale);

  return (
    <section
      aria-labelledby="streak-card-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="streak-card-title" className="text-sm font-sans font-semibold text-fg">
          {t("title")}
        </h2>
        <p role="status" aria-live="polite" className="text-xs font-sans font-medium text-fg-muted">
          {streakLength > 0 ? t("streakCount", { count: streakLength }) : t("startPrompt")}
        </p>
      </div>

      <StreakLadder cycleDay={cycleDay} hasCheckedInToday={hasCheckedInToday} locale={locale} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-sans text-fg-muted">
          {t("todaysRewardLabel")}:{" "}
          <span className="font-semibold text-reward">
            {formatPoints(asDisplayPoints(todaysReward), locale)}
          </span>
        </p>
        <Button type="button" size="sm" disabled={hasCheckedInToday} onClick={handleCheckIn}>
          {hasCheckedInToday ? t("checkedInCta") : t("checkInCta")}
        </Button>
      </div>

      <p className="text-[11px] font-sans text-fg-subtle">{t("fundingNote")}</p>
    </section>
  );
}
