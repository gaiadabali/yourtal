import type { Campaign } from "@yourtal/contracts/campaign";
import { formatPoints } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { formatDataCost, formatDuration } from "./campaign-format";
import { EntryCardFact } from "./campaign-entry-fact";
import { splitCampaignReward } from "./campaign-reward-split";
import { describeQuestionCount, describeScoringRule } from "./campaign-scoring-copy";

export interface CampaignEntryCardProps {
  campaign: Campaign;
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
export function CampaignEntryCard({ campaign }: CampaignEntryCardProps) {
  const { baseRewardPoints, maxAccuracyBonusPoints } = splitCampaignReward(campaign);
  const watchHref = `/watch/${campaign.id}`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs text-fg-subtle">{campaign.merchantName}</p>
          <h1 className="text-xl font-semibold text-fg">{campaign.title}</h1>
          <p className="text-sm text-fg-muted">{campaign.synopsis}</p>
        </header>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EntryCardFact label="Durasi" value={formatDuration(campaign.durationSeconds)} />
          <EntryCardFact label="Estimasi data" value={formatDataCost(campaign.estimatedDataMb)} />
          <EntryCardFact
            label="Reward dasar"
            value={formatPoints(baseRewardPoints)}
            valueClassName="text-reward"
          />
          {maxAccuracyBonusPoints > 0 ? (
            <EntryCardFact
              label="Bonus akurasi"
              value={`Hingga +${formatPoints(maxAccuracyBonusPoints)}`}
              valueClassName="text-reward"
            />
          ) : null}
          <EntryCardFact label="Pertanyaan" value={describeQuestionCount(campaign.questionCount)} />
          <EntryCardFact label="Aturan penilaian" value={describeScoringRule(campaign.scoringRule)} />
        </dl>

        <div className="flex items-start gap-2 rounded-md bg-surface px-3 py-2">
          <Badge variant="secondary" className="shrink-0">
            Jaminan
          </Badge>
          <p className="text-xs text-fg-muted">
            Ketentuan yang ditampilkan di halaman ini adalah ketentuan yang akan dihormati — durasi, reward, dan aturan penilaian
            tidak berubah setelah kamu mulai menonton.
          </p>
        </div>

        <Button asChild size="lg">
          {/* Plain anchor, not next/link: /watch/[campaignId] belongs to another
              in-flight ticket and may not exist on disk yet, and this is a
              real full navigation into a heavy player route we should not
              prefetch speculatively from the entry card. */}
          <a href={watchHref}>Mulai video</a>
        </Button>
      </CardContent>
    </Card>
  );
}
