import type { Campaign } from "@yourtal/contracts/campaign";
import type { PublicListing } from "@yourtal/contracts/listing";
import { asDisplayPoints, formatMoney, formatPointsIn } from "@yourtal/contracts/money/format";
import { formatDataCost, formatDuration } from "@/features/campaign/campaign-format";
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
 * Reuses `apps/web/features/campaign/campaign-format.ts` rather than
 * re-deriving duration copy. The base/bonus split itself is no longer
 * computed here at all (11.5.a deleted `campaign-reward-split.ts`'s
 * fabricated 60/40 ratio): `campaign.rewardPoints` is already the real base
 * amount, and `accuracyBonusPoints` below is the real bonus, read by the
 * caller from this campaign's own `CampaignTerms` — never invented.
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
  /** This campaign's real `CampaignTerms.accuracyBonusPoints` — `0` when the caller has no terms to read (never a fabricated ratio). */
  accuracyBonusPoints: number,
  locale: PublicLocaleConfig,
): CampaignRewardFacts {
  const baseRewardPoints = campaign.rewardPoints;
  const maxAccuracyBonusPoints = Math.max(0, Math.round(accuracyBonusPoints));
  const durationLabel = formatDuration(campaign.durationSeconds, locale.intlLocale);
  const dataCostLabel = formatDataCost(campaign.estimatedDataMb, locale.intlLocale);
  const baseRewardLabel = formatPointsIn(locale.intlLocale, baseRewardPoints);
  const accuracyBonusLabel =
    maxAccuracyBonusPoints > 0
      ? formatPointsIn(locale.intlLocale, asDisplayPoints(maxAccuracyBonusPoints))
      : null;

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
  // The listing's own currency (YT-0513), never the page's route locale —
  // a listing is always denominated in its own region's currency.
  const worthLabel = formatMoney(listing.faceValueMinor, listing.currency);
  const pointsLabel = formatPointsIn(locale.intlLocale, listing.priceInPoints);
  return { worthLabel, pointsLabel, headline: `${worthLabel} · ${pointsLabel}` };
}
