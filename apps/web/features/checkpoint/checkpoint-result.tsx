import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Question } from "@yourtal/contracts/question";
import { computeRewardSplit, totalEarned } from "./checkpoint-scoring";
import { formatPoints } from "@yourtal/contracts/money/format";
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
 */
export function CheckpointResult({ campaign, questions, answers }: CheckpointResultProps) {
  const split = computeRewardSplit(campaign, questions, answers);
  const hasBonus = split.accuracyFraction !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkpoint selesai</CardTitle>
        <CardDescription>Berikut rincian reward untuk video ini.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-raised p-4">
          <div>
            <p className="text-sm font-sans font-medium text-fg">Reward dasar</p>
            <p className="text-xs font-sans text-fg-subtle">Dijamin karena Anda menonton dan menjawab</p>
          </div>
          <Badge variant="reward">{formatPoints(split.baseReward)}</Badge>
        </div>

        {hasBonus ? (
          <div className="flex items-center justify-between gap-4 rounded-md border border-dashed border-border-strong p-4">
            <div>
              <p className="text-sm font-sans font-medium text-fg">Bonus akurasi</p>
              <p className="text-xs font-sans text-fg-subtle">
                {split.correctCount} dari {split.scorableCount} jawaban bernilai benar
                {" · "}
                {Math.round((split.accuracyFraction ?? 0) * 100)}% akurasi
              </p>
            </div>
            <Badge variant="reward">{formatPoints(split.earnedBonus)}</Badge>
          </div>
        ) : (
          <p className="text-xs font-sans text-fg-subtle">Campaign ini tidak memiliki bonus akurasi.</p>
        )}

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <p className="text-sm font-sans font-semibold text-fg">Total diterima</p>
          <p className="text-lg font-sans font-semibold text-reward">{formatPoints(totalEarned(split))}</p>
        </div>
      </CardContent>
    </Card>
  );
}
