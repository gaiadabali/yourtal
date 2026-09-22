"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Question } from "@yourtal/contracts/question";
import { computeRewardSplit, totalEarned } from "./checkpoint-scoring";
import { formatPoints } from "@yourtal/contracts/money/format";
import { useRegion } from "@/features/region/use-region";
import type { QuestionAnswer } from "./checkpoint-types";

export interface CheckpointResultProps {
  campaign: Campaign;
  questions: readonly Question[];
  answers: ReadonlyMap<string, QuestionAnswer>;
}

/**
 * Base reward and accuracy bonus are shown as two separate, differently
 * styled figures — never combined into one inflated number
 * (docs/tasks/phase-u-ui.md YT-0413). The base row is described as
 * guaranteed; the bonus row is visually distinct (dashed border, muted)
 * and its copy is explicitly conditional on accuracy, mirroring the
 * honesty rule on the entry card (YT-0411): the terms shown are the terms
 * honoured. When a campaign has no accuracy bonus at all (`base_only`, or
 * a bank with no scorable questions), that is stated plainly rather than
 * silently omitted.
 *
 * YT-0405: a Client Component (its only consumer, `checkpoint-quiz.tsx`, is
 * already `"use client"`), so it reads the active region and its
 * translations ambiently via `useRegion()`/`useTranslations()`.
 */
export function CheckpointResult({ campaign, questions, answers }: CheckpointResultProps) {
  const { locale } = useRegion();
  const t = useTranslations("checkpoint");
  const split = computeRewardSplit(campaign, questions, answers);
  const hasBonus = split.accuracyFraction !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("result.title")}</CardTitle>
        <CardDescription>{t("result.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-raised p-4">
          <div>
            <p className="text-sm font-sans font-medium text-fg">{t("result.baseReward")}</p>
            <p className="text-xs font-sans text-fg-subtle">{t("result.baseGuaranteed")}</p>
          </div>
          <Badge variant="reward">{formatPoints(split.baseReward, locale)}</Badge>
        </div>

        {hasBonus ? (
          <div className="flex items-center justify-between gap-4 rounded-md border border-dashed border-border-strong p-4">
            <div>
              <p className="text-sm font-sans font-medium text-fg">{t("result.accuracyBonus")}</p>
              <p className="text-xs font-sans text-fg-subtle">
                {t("result.accuracyDetail", {
                  correct: split.correctCount,
                  total: split.scorableCount,
                  percent: Math.round((split.accuracyFraction ?? 0) * 100),
                })}
              </p>
            </div>
            <Badge variant="reward">{formatPoints(split.earnedBonus, locale)}</Badge>
          </div>
        ) : (
          <p className="text-xs font-sans text-fg-subtle">{t("result.noBonus")}</p>
        )}

        {/* YT-0564. This said "Total received" / "Total diterima" — a
            past-tense claim that money had arrived, beside a figure from the
            client scoring module, which O-5 made advisory. Under O-1 nothing
            is granted until full playback AND answered questions, and the
            server's `complete` refuses every completion today, so the number
            was certainly unreceived at the moment it rendered. Risk 44 in a
            second component: that one was a "Reward so far" tally implying
            accrual; this claimed the accrual had landed. */}
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-sans font-semibold text-fg">{t("result.totalExpected")}</p>
            <p className="text-lg font-sans font-semibold text-reward">
              {formatPoints(totalEarned(split), locale)}
            </p>
          </div>
          <p className="text-xs font-sans text-fg-subtle">{t("result.totalPendingNote")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
