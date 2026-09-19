import type { Listing } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent } from "@yourtal/ui/card";
import { categoryLabel } from "@/features/store/store-category";
import { formatExpiryDate, formatStockRemaining } from "@/features/store/store-format";
import { listingStatusPresentation } from "@/features/store/store-status";
import { listingDistricts } from "@/features/store/listing-locations";
import { getPublicTranslator } from "./public-i18n";
import { PublicFact } from "./public-fact";
import { PublicCtaLink } from "./public-cta-link";
import { computeOfferRewardFacts } from "./public-reward-facts";
import type { PublicLocaleConfig } from "./public-locale";

export interface PublicOfferContentProps {
  listing: Listing;
  locale: PublicLocaleConfig;
  merchantHref: string;
}

/**
 * The public offer/voucher page's body (YT-0431,
 * `/[locale]/rewards/[merchant]/[offerId]`). Mirrors the fact set
 * `StoreOfferCard` (`apps/web/features/store/store-offer-card.tsx`) shows a
 * logged-in user — price, terms, category, location, stock, expiry — reusing
 * its pure formatters (`store-format.ts`, `store-category.ts`,
 * `store-status.ts`) rather than rebuilding them. What is different on
 * purpose: there is no logged-in balance here (`StoreBalanceNotice` needs a
 * `Balance` an anonymous visitor does not have), so the single action is
 * signing up, and the call to action names the voucher's genuine face value
 * and its points price together (`public-reward-facts.ts`'s "points-pricing
 * trap" reasoning) rather than a redeem button gated on a balance that does
 * not exist yet.
 */
export function PublicOfferContent({ listing, locale, merchantHref }: PublicOfferContentProps) {
  const t = getPublicTranslator(locale.intlLocale);
  const status = listingStatusPresentation(listing.status);
  const facts = computeOfferRewardFacts(listing, locale);

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-fg-subtle">{t("offer.eyebrow")}</p>
          <a href={merchantHref} className="text-xs text-fg-subtle hover:underline">
            {listing.merchantName}
          </a>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-semibold text-fg">{listing.title}</h1>
            {status ? <Badge variant={status.badgeVariant}>{status.label}</Badge> : null}
          </div>
          <p className="text-sm text-fg-muted">{listing.description}</p>
        </header>

        <div className="flex items-baseline gap-2 rounded-md bg-surface px-3 py-3">
          <span className="text-2xl font-semibold text-price">{facts.pointsLabel}</span>
          <span className="text-sm text-fg-muted">
            {t("offer.worthLabel")} {facts.worthLabel}
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PublicFact label={t("offer.categoryLabel")} value={categoryLabel(listing.category)} />
          <PublicFact
            label={t("offer.districtLabel")}
            value={listingDistricts(listing).join(", ")}
          />
          <PublicFact
            label={t("offer.stockLabel")}
            value={formatStockRemaining(listing.stockRemaining, locale.intlLocale)}
          />
          <PublicFact
            label={t("offer.expiryLabel")}
            value={formatExpiryDate(listing.expiresAt, locale.intlLocale)}
          />
        </dl>

        <p className="text-sm text-fg-muted">
          {t("offer.ctaBody", { worth: facts.worthLabel, points: facts.pointsLabel })}
        </p>

        <PublicCtaLink href="/onboarding">{t("offer.ctaButton")}</PublicCtaLink>
      </CardContent>
    </Card>
  );
}
