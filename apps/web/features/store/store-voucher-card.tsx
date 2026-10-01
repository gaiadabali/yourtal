import type { PublicListing } from "@yourtal/contracts/listing";
import { CoinMark } from "@yourtal/ui/brand/coin-mark";
import { cn } from "@yourtal/ui/cn";
import { formatListingPrice, formatStockRemaining } from "./store-format";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";
import { listingStatusPresentation } from "./store-status";

export interface StoreVoucherCardProps {
  listing: PublicListing;
  locale: SupportedLocale;
  /** 13.4.a: the first row's images load first. */
  priority?: boolean;
}

const SHORT_DATE: Record<SupportedLocale, Intl.DateTimeFormat> = {
  "en-AU": new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }),
  "id-ID": new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }),
};

/** Fewer than this many left is called out in amber. */
const LOW_STOCK = 10;

/**
 * 13.15.b: a voucher the way a shop shows a product: the image, the brand
 * (linking to its brand page), the title, the points price in gold, and how
 * many are left and until when.
 */
export function StoreVoucherCard({ listing, locale, priority = false }: StoreVoucherCardProps) {
  const t = getStoreTranslator(locale);
  const status = listingStatusPresentation(listing.status, locale);
  const { pointsLabel, faceValueLabel } = formatListingPrice(
    listing.priceInPoints,
    listing.faceValueMinor,
    locale,
    listing.currency,
  );
  const soldOut = listing.stockRemaining === 0;
  const low = !soldOut && listing.stockRemaining < LOW_STOCK;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-border-subtle bg-surface transition-shadow duration-(--duration-base) ease-standard hover:shadow-md">
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-sunken">
        <img
          src={listing.imageUrl}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          width={480}
          height={360}
          className={cn(
            "h-full w-full object-cover transition-transform duration-(--duration-slow) ease-standard group-hover:scale-[1.03]",
            soldOut && "grayscale",
          )}
        />
        {status ? (
          <span className="absolute left-2 top-2 rounded-pill bg-overlay px-2 py-0.5 text-caption font-sans font-bold text-white">
            {status.label}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <a
          href={`/store/brand/${listing.merchantId}`}
          className="relative z-10 block max-w-full truncate text-caption font-sans font-semibold uppercase tracking-wide text-fg-muted hover:text-accent"
        >
          {listing.merchantName}
        </a>
        <h3 className="line-clamp-2 text-body font-sans font-semibold leading-snug text-fg">
          <a
            href={`/store/${listing.id}`}
            className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
          >
            {listing.title}
          </a>
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <p className="flex min-w-0 flex-col">
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-body font-sans font-bold tabular-nums text-fg">
              <CoinMark size={16} className="shrink-0" />
              {pointsLabel}
            </span>
            <span className="text-caption font-sans text-fg-subtle">{faceValueLabel}</span>
          </p>
          <p className="flex shrink-0 flex-col items-end text-caption font-sans">
            <span
              className={cn(
                "font-semibold",
                soldOut ? "text-danger-solid" : low ? "text-warning-solid" : "text-fg-muted",
              )}
            >
              {formatStockRemaining(listing.stockRemaining, locale)}
            </span>
            <span className="text-fg-subtle">
              {t("shop.ends", { date: SHORT_DATE[locale].format(new Date(listing.expiresAt)) })}
            </span>
          </p>
        </div>
      </div>
    </article>
  );
}
