import type { Campaign } from "@yourtal/contracts/campaign";
import type { PublicListing } from "@yourtal/contracts/listing";
import { formatMoney, formatPoints } from "@yourtal/contracts/money/format";
import { formatDataCost, formatDuration } from "@/features/campaign/campaign-format";
import { splitCampaignReward } from "@/features/campaign/campaign-reward-split";
import type { PublicLocaleConfig } from "./public-locale";

/**
 * The one honesty-critical computation this ticket exists to get right
 * (YT-0431 acceptance: "One honest call to action naming the actual reward
 * value"). Kept as plain, pure data — no JSX, no translator — so the exact
 * same numbers reach both the page body and the generated OG share card
 * (`docs/11-seo-aeo-geo.md`'s Open Graph requirement: "Include the reward
 * and duration in the card, for the same honesty reason" as the page copy).
 * A CTA that shows the reward on the page but not on the card it gets shared
 * as would be the dishonest split this ticket is explicitly warned against.
 *
 * Reuses `apps/web/features/campaign/campaign-format.ts` and
 * `campaign-reward-split.ts` rather than re-deriving duration/reward copy —
 * this ticket's brief is explicit that those existing formatters are the
 * source of truth for what an entity's facts look like; only the campaign
 * feature's own React components (off limits for this ticket) are not
 * reused.
 */
export interface CampaignRewardFacts {
  durationLabel: string;
  dataCostLabel: string;
  baseRewardLabel: string;
  /** `null` when the campaign has no accuracy bonus (`scoringRule === "base_only"`). */
  accuracyBonusLabel: string | null;
  /** One combined, natural-language sentence naming both reward and duration — never one without the other. */
  headline: string;
}

export function computeCampaignRewardFacts(
  campaign: Campaign,
  locale: PublicLocaleConfig,
): CampaignRewardFacts {
  const { baseRewardPoints, maxAccuracyBonusPoints } = splitCampaignReward(campaign);
  const durationLabel = formatDuration(campaign.durationSeconds, locale.intlLocale);
  const dataCostLabel = formatDataCost(campaign.estimatedDataMb, locale.intlLocale);
  const baseRewardLabel = formatPoints(baseRewardPoints, locale.intlLocale);
  const accuracyBonusLabel =
    maxAccuracyBonusPoints > 0 ? formatPoints(maxAccuracyBonusPoints, locale.intlLocale) : null;

  const headline =
    accuracyBonusLabel === null
      ? `${baseRewardLabel} · ${durationLabel}`
      : `${baseRewardLabel} (+${accuracyBonusLabel}) · ${durationLabel}`;

  return { durationLabel, dataCostLabel, baseRewardLabel, accuracyBonusLabel, headline };
}

export interface OfferRewardFacts {
  /** The voucher's genuine face value (docs/11 §5's "genuine face value, not a points fiction"). */
  worthLabel: string;
  pointsLabel: string;
  headline: string;
}

export function computeOfferRewardFacts(
  listing: PublicListing,
  locale: PublicLocaleConfig,
): OfferRewardFacts {
  const worthLabel = formatMoney(listing.faceValueIdr, locale.currency);
  const pointsLabel = formatPoints(listing.priceInPoints, locale.intlLocale);
  return { worthLabel, pointsLabel, headline: `${worthLabel} · ${pointsLabel}` };
}
