"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { CoinMark } from "@yourtal/ui/brand/coin-mark";
import { cn } from "@yourtal/ui/cn";
import { formatFeedDuration, formatFeedPoints, type FeedLocale } from "./feed-terms";
import type { BrowseItem } from "./home-data";
import { useCategoryLabel } from "./use-category-label";
import { VideoCardMenu } from "./video-card-menu";

export interface VideoCardProps {
  item: BrowseItem;
  locale: FeedLocale;
  saved: boolean;
  shareUrl: string;
  /** A featured card is larger and shows the synopsis. */
  size?: "grid" | "feature";
}

/**
 * 13.13.a/e: a long-video card laid out the way YouTube does it: a 16:9
 * poster with the duration, then channel, title and terms underneath. The
 * poster and title open the watch page; Save, Not interested and Share sit in
 * the ⋮ menu. The gold coin pill on the poster is what the video earns.
 */
export function VideoCard({ item, locale, saved, shareUrl, size = "grid" }: VideoCardProps) {
  const t = useTranslations("feed");
  const categoryLabel = useCategoryLabel();
  const [hidden, setHidden] = useState(false);
  const href = `/watch/${item.campaignId}`;
  const feature = size === "feature";

  if (hidden) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-card border border-dashed border-border-subtle p-4 text-center">
        <p className="text-body-sm font-sans text-fg-muted">{t("actions.hidden")}</p>
      </div>
    );
  }

  return (
    <article className="group flex flex-col gap-3">
      <a
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block overflow-hidden rounded-card bg-surface-sunken"
      >
        <img
          src={item.posterUrl}
          alt=""
          loading="lazy"
          className="aspect-video w-full object-cover transition-transform duration-(--duration-slow) ease-standard group-hover:scale-[1.03]"
        />
        {/* On-image chrome stays light-on-dark in both themes, like MediaCard's. */}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-pill bg-overlay py-0.5 pl-0.5 pr-2 text-caption font-sans font-bold text-white">
          <CoinMark size={16} />
          {t("terms.upTo", { points: formatFeedPoints(locale, item.maxRewardPoints) })}
        </span>
        <span className="absolute bottom-2 right-2 rounded-control bg-overlay px-1.5 py-0.5 text-caption font-sans font-medium tabular-nums text-white">
          {formatFeedDuration(t, item.durationSeconds)}
        </span>
      </a>
      <div className="relative flex gap-3 pr-9">
        <a href={`/c/${item.channelHandle}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
          <ChannelAvatar
            decorative
            name={item.merchantName}
            size="md"
            {...(item.channelLogoUrl ? { src: item.channelLogoUrl } : {})}
          />
        </a>
        <div className="flex min-w-0 flex-col gap-1">
          <h3
            className={cn(
              "line-clamp-2 font-display font-bold text-balance text-fg",
              feature ? "text-headline" : "text-body leading-snug",
            )}
          >
            <a
              href={href}
              className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {item.title}
            </a>
          </h3>
          {feature && item.synopsis ? (
            <p className="line-clamp-2 text-body-sm font-sans text-fg-muted">{item.synopsis}</p>
          ) : null}
          <a
            href={`/c/${item.channelHandle}`}
            className="line-clamp-1 w-fit text-body-sm font-sans text-fg-muted hover:text-fg"
          >
            {item.merchantName}
          </a>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption font-sans text-fg-muted">
            {/* 12.4.d/#9 and 13.23.f (F90): "Sponsored" when boosted, else "Brand video". */}
            <span className="rounded-pill border border-border-control px-1.5 font-medium">
              {item.boosted ? t("item.sponsored") : t("item.brandVideo")}
            </span>
            <span>{categoryLabel(item.contentCategory)}</span>
            {item.questionCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("terms.questions", { count: item.questionCount })}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="absolute -right-1 -top-1">
          <VideoCardMenu
            campaignId={item.campaignId}
            title={item.title}
            initialSaved={saved}
            shareUrl={shareUrl}
            onHidden={() => setHidden(true)}
          />
        </div>
      </div>
    </article>
  );
}
