import Link from "next/link";
import type { Route } from "next";
import type { Campaign } from "@yourtal/contracts/campaign";
import { formatPoints } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { CampaignCardLayout } from "./campaign-card-layout";
import { formatDataCost, formatDuration } from "./campaign-format";
import { getCampaignTranslator, type SupportedLocale } from "./campaign-i18n";

export interface CampaignCardProps {
  campaign: Campaign;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: SupportedLocale;
}

/**
 * One card on the earn board (YT-0410). Every card states
 * duration · reward · estimated MB · merchant per the acceptance criteria —
 * none of the four is ever omitted, and the reward is worded "Hingga …" /
 * "Up to …" whenever it includes an accuracy bonus, so the board never
 * shows an inflated single number for a campaign whose reward is
 * conditional (docs/06-longform-video-and-attention.md §4.2).
 *
 * Only the title is a real link; a `::after` pseudo-element (`stretched
 * link` pattern) extends the click target to the whole card, so the card
 * has one clear accessible name instead of one giant link swallowing every
 * word in the card.
 */
export function CampaignCard({ campaign, locale = "id-ID" }: CampaignCardProps) {
  // typedRoutes only validates literal href strings; a computed one needs an
  // explicit `Route` cast (documented Next.js escape hatch). Safe here
  // because `/campaign/[campaignId]/page.tsx` exists and `campaign.id` is a
  // schema-validated UUID, never arbitrary user input.
  const href = `/campaign/${campaign.id}` as Route;
  const t = getCampaignTranslator(locale);
  const rewardLabel =
    campaign.scoringRule === "base_plus_accuracy_bonus"
      ? t("card.upToReward", { amount: formatPoints(campaign.rewardPoints, locale) })
      : formatPoints(campaign.rewardPoints, locale);

  return (
    <CampaignCardLayout
      className="relative"
      merchantSlot={
        <p className="truncate text-xs text-fg-subtle" title={campaign.merchantName}>
          {campaign.merchantName}
        </p>
      }
      titleSlot={
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-fg">
          <Link href={href} className="static after:absolute after:inset-0 after:content-['']">
            {campaign.title}
          </Link>
        </h3>
      }
      metaSlot={
        <div className="flex items-center gap-1.5 text-xs text-fg-muted">
          <span>{formatDuration(campaign.durationSeconds, locale)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDataCost(campaign.estimatedDataMb, locale)}</span>
        </div>
      }
      footerSlot={
        <>
          <Badge variant="reward">{rewardLabel}</Badge>
          {campaign.kind === "quick" ? (
            <Badge variant="outline">{t("card.quickBadge")}</Badge>
          ) : null}
        </>
      }
    />
  );
}
