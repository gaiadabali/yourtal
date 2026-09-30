import { getTranslations } from "next-intl/server";
import { Clock, HeartHandshake } from "lucide-react";
import type { Auction } from "@yourtal/contracts/auction/auction";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { cn } from "@yourtal/ui/cn";
import { timeLeftParts } from "./auction-time";

export interface AuctionCardProps {
  auction: Auction;
  locale: "en-AU" | "id-ID";
  nowMs: number;
}

const STANDING = {
  leading: "success",
  outbid: "warning",
  won: "success",
  lost: "neutral",
} as const;

/**
 * 13.22.d: one auction as a card: the charity it raises money for first, then
 * the voucher, the current bid and bid count (never who bid), and time left.
 */
export async function AuctionCard({ auction, locale, nowMs }: AuctionCardProps) {
  const t = await getTranslations("auction");
  const left = timeLeftParts(auction.endsAt, nowMs);
  const closing = auction.state === "open" && Date.parse(auction.endsAt) - nowMs < 3_600_000;
  const standing = auction.viewer.bidStatus;
  return (
    <article className="group relative flex h-full flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4 transition-shadow hover:shadow-md">
      <p className="flex items-center gap-2 text-caption font-sans font-semibold text-success-on-subtle">
        <HeartHandshake aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="truncate">{t("forCharity", { name: auction.charity.name })}</span>
      </p>
      <div className="min-w-0">
        <p className="truncate text-caption font-sans font-semibold uppercase tracking-wide text-fg-muted">
          {auction.voucher.merchantName}
        </p>
        <h3 className="line-clamp-2 text-body font-sans font-semibold text-fg">
          <a
            href={`/auctions/${auction.auctionId}`}
            className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
          >
            {auction.voucher.title}
          </a>
        </h3>
        <p className="text-caption font-sans text-fg-subtle">
          {t("worth")}{" "}
          <MoneyAmount
            amountMinor={auction.voucher.faceValueMinor}
            currency={auction.currency}
            locale={locale}
          />
        </p>
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-caption font-sans text-fg-muted">
            {auction.currentAmountMinor === null ? t("startsAt") : t("currentBid")}
          </span>
          <MoneyAmount
            amountMinor={auction.currentAmountMinor ?? auction.reserveMinor}
            currency={auction.currency}
            locale={locale}
            className="font-display text-title font-bold text-fg"
          />
          <span className="text-caption font-sans text-fg-subtle">
            {t("bidCount", { count: auction.bidCount })}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          {standing !== "none" ? (
            <StatusBadge status={STANDING[standing]} emphasis="subtle">
              {t(`standing.${standing}`)}
            </StatusBadge>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center gap-1 text-caption font-sans font-semibold",
              closing ? "text-danger-solid" : "text-fg-muted",
            )}
          >
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            {t(`left.${left.key}`, left.values)}
          </span>
        </div>
      </div>
    </article>
  );
}
