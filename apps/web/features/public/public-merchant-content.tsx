import { Card, CardContent } from "@yourtal/ui/card";
import { formatPoints } from "@yourtal/contracts/money/format";
import { formatDuration } from "@/features/campaign/campaign-format";
import { formatListingPrice } from "@/features/store/store-format";
import { getPublicTranslator } from "./public-i18n";
import type { PublicMerchant } from "./public-merchant";
import type { PublicLocale, PublicLocaleConfig } from "./public-locale";

export interface PublicMerchantContentProps {
  merchant: PublicMerchant;
  locale: PublicLocale;
  localeConfig: PublicLocaleConfig;
}

/**
 * The public merchant page's body (YT-0431, `/[locale]/m/[merchant]`). This
 * is not `Business`-backed — see `public-merchant.ts`'s header for why —
 * so it only ever states what its own campaigns and listings say about the
 * merchant: its name, the district most of its listings share, and its live
 * campaigns and offers, each linking to that entity's own honest page.
 */
export function PublicMerchantContent({
  merchant,
  locale,
  localeConfig,
}: PublicMerchantContentProps) {
  const t = getPublicTranslator(localeConfig.intlLocale);

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-fg-subtle">{t("merchant.eyebrow")}</p>
          <h1 className="text-xl font-semibold text-fg">{merchant.name}</h1>
          {merchant.district ? (
            <p className="text-sm text-fg-muted">
              {t("merchant.districtLabel")}: {merchant.district}
            </p>
          ) : null}
        </header>

        <section aria-labelledby="merchant-campaigns-heading" className="flex flex-col gap-2">
          <h2 id="merchant-campaigns-heading" className="text-sm font-semibold text-fg">
            {t("merchant.campaignsHeading")}
          </h2>
          {merchant.campaigns.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("merchant.noCampaigns")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {merchant.campaigns.map((campaign) => (
                <li key={campaign.id}>
                  <a
                    href={`/${locale}/c/${campaign.id}`}
                    className="text-sm text-fg hover:underline"
                  >
                    {campaign.title}
                  </a>
                  <span className="ml-2 text-xs text-fg-subtle">
                    {formatPoints(campaign.rewardPoints, localeConfig.intlLocale)} ·{" "}
                    {formatDuration(campaign.durationSeconds, localeConfig.intlLocale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="merchant-offers-heading" className="flex flex-col gap-2">
          <h2 id="merchant-offers-heading" className="text-sm font-semibold text-fg">
            {t("merchant.offersHeading")}
          </h2>
          {merchant.listings.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("merchant.noOffers")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {merchant.listings.map((listing) => {
                const price = formatListingPrice(
                  listing.priceInPoints,
                  listing.faceValueIdr,
                  localeConfig.intlLocale,
                  localeConfig.currency,
                );
                return (
                  <li key={listing.id}>
                    <a
                      href={`/${locale}/rewards/${merchant.slug}/${listing.id}`}
                      className="text-sm text-fg hover:underline"
                    >
                      {listing.title}
                    </a>
                    <span className="ml-2 text-xs text-fg-subtle">
                      {price.pointsLabel} · {price.faceValueLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
