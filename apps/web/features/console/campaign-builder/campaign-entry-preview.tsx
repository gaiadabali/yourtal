import {
  asDisplayIdr,
  asDisplayPoints,
  formatMoney,
  formatPoints,
} from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { useRegion } from "@/features/region/use-region";
import type { CampaignDraft } from "./campaign-draft";
import {
  draftCompleteQuestionCount,
  draftDurationSeconds,
  draftEstimatedDataMb,
} from "./campaign-draft";
import { assessRewardToDataCost, describeRewardDataCostRatio } from "./campaign-reward-risk";
import {
  describePreviewQuestionCount,
  describePreviewScoringRule,
  formatPreviewDataCost,
  formatPreviewDuration,
  splitPreviewReward,
} from "./campaign-preview-format";

export interface CampaignEntryPreviewProps {
  draft: CampaignDraft;
}

/**
 * "Live preview of exactly what the user will see on the entry card"
 * (YT-0441's own wording). This mirrors the REAL entry card's contract —
 * duration, data cost, base reward, accuracy bonus, question count, scoring
 * rule, all shown before a single primary action, in the same order
 * (`features/campaign/campaign-entry-card.tsx`, YT-0411) — computed from
 * the exact numbers the advertiser has entered so far.
 *
 * It is a fresh implementation rather than importing that component
 * directly: `CampaignEntryCard` transitively value-imports
 * `@yourtal/contracts/money` and `next-intl` (via `campaign-reward-split.ts`
 * / `campaign-i18n.ts`), and this preview lives inside `campaign-editor.tsx`
 * — a "use client" tree re-rendering on every keystroke. Pulling that chain
 * into this route blew the 200 KB gz budget to ~287 KB in an earlier
 * version of this file (see this ticket's report) — `formatMoney`/
 * `formatPoints` (from the dependency-free `money/format.ts`) are reused
 * as-is, and everything else route through `campaign-preview-format.ts`'s
 * local, zero-dependency equivalents instead. `useRegion()` still supplies
 * the real ambient currency (`docs/17`'s AU/ID split) — never a hardcoded
 * "Rp".
 */
export function CampaignEntryPreview({ draft }: CampaignEntryPreviewProps) {
  const { currency } = useRegion();
  const durationSeconds = draftDurationSeconds(draft);
  const estimatedDataMb = draftEstimatedDataMb(draft);
  const questionCount = draftCompleteQuestionCount(draft);
  const hasAccuracyBonus = draft.scoringRule === "base_plus_accuracy_bonus" && questionCount > 0;
  const { basePoints, maxAccuracyBonusPoints } = splitPreviewReward(
    draft.rewardPoints,
    hasAccuracyBonus,
  );
  const assessment = assessRewardToDataCost(draft.rewardPoints, estimatedDataMb, currency);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <p className="text-xs font-sans text-fg-subtle">Entry card preview</p>
        <header className="flex flex-col gap-1">
          <p className="text-xs text-fg-subtle">{draft.merchantName}</p>
          <h2 className="text-lg font-semibold text-fg">
            {draft.title.trim() || "Untitled campaign"}
          </h2>
          <p className="text-sm text-fg-muted">{draft.synopsis.trim() || "No synopsis yet."}</p>
        </header>

        <dl className="grid grid-cols-2 gap-3">
          <PreviewFact label="Duration" value={formatPreviewDuration(durationSeconds)} />
          <PreviewFact label="Data cost" value={formatPreviewDataCost(estimatedDataMb)} />
          <PreviewFact
            label="Base reward"
            value={formatPoints(asDisplayPoints(basePoints), "en-AU")}
            valueClassName="text-reward"
          />
          {maxAccuracyBonusPoints > 0 ? (
            <PreviewFact
              label="Accuracy bonus"
              value={`Up to ${formatPoints(asDisplayPoints(maxAccuracyBonusPoints), "en-AU")}`}
              valueClassName="text-reward"
            />
          ) : null}
          <PreviewFact label="Questions" value={describePreviewQuestionCount(questionCount)} />
          <PreviewFact label="Scoring" value={describePreviewScoringRule(hasAccuracyBonus)} />
        </dl>

        <div className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2">
          <Badge variant={assessment.meetsGuideline ? "success" : "warning"} className="shrink-0">
            {formatMoney(asDisplayIdr(assessment.dataCostMinorUnits), currency)} data cost
          </Badge>
          <p className="text-xs font-sans text-fg-muted">
            {describeRewardDataCostRatio(assessment)}
          </p>
        </div>

        <Button size="lg" disabled aria-label="Start video — preview only, not interactive here">
          Start video
        </Button>
      </CardContent>
    </Card>
  );
}

interface PreviewFactProps {
  label: string;
  value: string;
  valueClassName?: string;
}

/** Local subcomponent, mirrors `campaign-entry-fact.tsx`'s shape without importing it (same budget reasoning as the module doc above). */
function PreviewFact({ label, value, valueClassName }: PreviewFactProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className={`text-sm font-medium text-fg ${valueClassName ?? ""}`}>{value}</dd>
    </div>
  );
}
