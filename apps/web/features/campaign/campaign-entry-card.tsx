import type { Campaign } from "@yourtal/contracts/campaign";
import { formatPoints } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { formatDataCost, formatDuration } from "./campaign-format";
import { EntryCardFact } from "./campaign-entry-fact";
import { splitCampaignReward } from "./campaign-reward-split";
import { describeQuestionCount, describeScoringRule } from "./campaign-scoring-copy";
import { getCampaignTranslator, type SupportedLocale } from "./campaign-i18n";

export interface CampaignEntryCardProps {
  campaign: Campaign;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: SupportedLocale;
}

/**
 * The campaign entry card (YT-0411) — "the product's honesty claim"
 * (docs/06-longform-video-and-attention.md §3: "Set the right expectation
 * at entry"). Every fact required by the acceptance criteria is a plain
 * text row, visible without expanding anything, and appears *before* the
 * single primary action in document order — so duration is never
 * discoverable only after the user has already started playback.
 *
 * The base reward and any accuracy bonus are two separate rows, never one
 * combined headline number (docs/06 §4.2's "never change the terms after
 * the watch begins" principle extends to never inflating them up front
 * either).
 */
export function CampaignEntryCard({ campaign, locale = "id-ID" }: CampaignEntryCardProps) {
  const { baseRewardPoints, maxAccuracyBonusPoints } = splitCampaignReward(campaign);
  const watchHref = `/watch/${campaign.id}`;
  const t = getCampaignTranslator(locale);

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs text-fg-subtle">{campaign.merchantName}</p>
          <h1 className="text-xl font-semibold text-fg">{campaign.title}</h1>
          <p className="text-sm text-fg-muted">{campaign.synopsis}</p>
        </header>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EntryCardFact
            label={t("entry.duration")}
            value={formatDuration(campaign.durationSeconds, locale)}
          />
          <EntryCardFact
            label={t("entry.dataCost")}
            value={formatDataCost(campaign.estimatedDataMb, locale)}
          />
          <EntryCardFact
            label={t("entry.baseReward")}
            value={formatPoints(baseRewardPoints, locale)}
            valueClassName="text-reward"
          />
          {maxAccuracyBonusPoints > 0 ? (
            <EntryCardFact
              label={t("entry.accuracyBonus")}
              value={t("entry.upToBonus", { amount: formatPoints(maxAccuracyBonusPoints, locale) })}
              valueClassName="text-reward"
            />
          ) : null}
          <EntryCardFact
            label={t("entry.questionCount")}
            value={describeQuestionCount(campaign.questionCount, locale)}
          />
          <EntryCardFact
            label={t("entry.scoringRule")}
            value={describeScoringRule(campaign.scoringRule, locale)}
          />
        </dl>

        {/* flex-wrap: at 320px x 200% zoom the card interior is narrower
            than the badge + guarantee sentence can share on one row, even
            once the sentence wraps at word boundaries — the badge drops to
            its own line instead of forcing the row wider than the card. */}
        <div className="flex flex-wrap items-start gap-2 rounded-md bg-surface px-3 py-2">
          <Badge variant="secondary" className="shrink-0">
            {t("entry.guaranteeBadge")}
          </Badge>
          {/* min-w-0 lets this paragraph shrink/wrap instead of a flex
              item's default content-based automatic minimum size (its
              widest word) forcing the row wider than the card; break-words
              additionally allows wrapping mid-word for the rare case where
              even a single word doesn't fit the available width. */}
          <p className="min-w-0 break-words text-xs text-fg-muted">{t("entry.guaranteeText")}</p>
        </div>

        <Button asChild size="lg">
          {/* Plain anchor, not next/link: /watch/[campaignId] belongs to another
              in-flight ticket and may not exist on disk yet, and this is a
              real full navigation into a heavy player route we should not
              prefetch speculatively from the entry card. */}
          <a href={watchHref}>{t("entry.startVideo")}</a>
        </Button>
      </CardContent>
    </Card>
  );
}
