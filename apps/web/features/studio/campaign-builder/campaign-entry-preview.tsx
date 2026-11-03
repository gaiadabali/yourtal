import { useLocale, useTranslations } from "next-intl";
import { asDisplayPoints, formatPointsIn } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { formatMoneyAmount } from "@yourtal/ui/money-amount";
import { useRegion } from "@/features/region/use-region";
import type { CampaignDraft } from "./campaign-draft";
import { draftDurationSeconds, draftEstimatedDataMb, draftQuestionsAsked } from "./campaign-draft";
import { assessRewardToDataCost, rewardRatioText, rewardRatioView } from "./campaign-reward-risk";
import { draftRewardUnsaved } from "./campaign-reward-patch";
import {
  describePreviewQuestionCount,
  describePreviewScoringRule,
  formatPreviewDataCost,
  formatPreviewDuration,
  splitPreviewReward,
} from "./campaign-preview-format";

export interface CampaignEntryPreviewProps {
  draft: CampaignDraft;
  /**
   * The video's real length is not known yet (live, before it has been processed), so
   * the length, data cost and questions are shown as pending rather than as a figure
   * worked out from a placeholder that then changes.
   */
  durationPending?: boolean;
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
export function CampaignEntryPreview({
  draft,
  durationPending = false,
}: CampaignEntryPreviewProps) {
  const t = useTranslations("studio");
  const locale = useLocale() === "id-ID" ? "id-ID" : "en-AU";
  const { currency } = useRegion();
  const durationSeconds = draftDurationSeconds(draft);
  const estimatedDataMb = draftEstimatedDataMb(draft);
  const questionCount = draftQuestionsAsked(draft);
  const hasAccuracyBonus = draft.scoringRule === "base_plus_accuracy_bonus" && questionCount > 0;
  const { basePoints, maxAccuracyBonusPoints } = splitPreviewReward(
    draft.rewardPoints,
    draft.accuracyBonusPoints,
    hasAccuracyBonus,
  );
  const rewardUnsaved = draftRewardUnsaved(draft);
  // The same view the Reward tab's banner reads, so the two never disagree.
  const ratio = rewardRatioView({
    rewardPoints: draft.rewardPoints,
    rewardValueMinorUnits: draft.rewardValueMinorUnits,
    estimatedDataMb,
    currency,
    durationPending,
    rewardUnsaved,
  });
  const pending = t("campaignBuilder.preview.pending");
  const dataCostMinorUnits = assessRewardToDataCost(
    null,
    estimatedDataMb,
    currency,
  ).dataCostMinorUnits;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <p className="text-xs font-sans text-fg-subtle">{t("campaignBuilder.preview.heading")}</p>
        <header className="flex flex-col gap-1">
          <p className="text-xs text-fg-subtle">{draft.merchantName}</p>
          <h2 className="text-lg font-semibold text-fg">
            {draft.title.trim() || t("campaignBuilder.preview.untitled")}
          </h2>
          <p className="text-sm text-fg-muted">
            {draft.synopsis.trim() || t("campaignBuilder.preview.noSynopsis")}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-3">
          <PreviewFact
            label={t("campaignBuilder.preview.duration")}
            value={durationPending ? pending : formatPreviewDuration(durationSeconds, t)}
          />
          <PreviewFact
            label={t("campaignBuilder.preview.dataCost")}
            value={durationPending ? pending : formatPreviewDataCost(estimatedDataMb, t)}
          />
          <PreviewFact
            label={t("campaignBuilder.preview.baseReward")}
            value={
              rewardUnsaved
                ? `${formatPointsIn(locale, asDisplayPoints(basePoints))} (${t("campaignBuilder.preview.unsaved")})`
                : formatPointsIn(locale, asDisplayPoints(basePoints))
            }
            valueClassName="text-reward"
          />
          {maxAccuracyBonusPoints > 0 ? (
            <PreviewFact
              label={t("campaignBuilder.preview.accuracyBonus")}
              value={t("campaignBuilder.preview.upToPoints", {
                points: formatPointsIn(locale, asDisplayPoints(maxAccuracyBonusPoints)),
              })}
              valueClassName="text-reward"
            />
          ) : null}
          <PreviewFact
            label={t("campaignBuilder.preview.questions")}
            value={durationPending ? pending : describePreviewQuestionCount(questionCount, t)}
          />
          <PreviewFact
            label={t("campaignBuilder.preview.scoring")}
            value={describePreviewScoringRule(hasAccuracyBonus, t)}
          />
        </dl>

        {durationPending ? (
          <p className="text-xs font-sans text-fg-muted">
            {t("campaignBuilder.preview.pendingNote")}
          </p>
        ) : null}
        {rewardUnsaved ? (
          <p className="text-xs font-sans text-fg-muted">
            {t("campaignBuilder.preview.unsavedNote")}
          </p>
        ) : null}

        <div className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2">
          <Badge
            variant={
              ratio.note === "meetsGuideline" || ratio.note === "noDataCost"
                ? "success"
                : ratio.note === "belowGuideline"
                  ? "warning"
                  : "secondary"
            }
            className="shrink-0"
          >
            {durationPending
              ? t("campaignBuilder.preview.dataCostBadgePending")
              : t("campaignBuilder.preview.dataCostBadge", {
                  amount: formatMoneyAmount(dataCostMinorUnits, currency, locale),
                })}
          </Badge>
          <p className="text-xs font-sans text-fg-muted">{rewardRatioText(ratio, t)}</p>
        </div>

        <Button size="lg" disabled aria-label={t("campaignBuilder.preview.startVideoAriaLabel")}>
          {t("campaignBuilder.preview.startVideo")}
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
