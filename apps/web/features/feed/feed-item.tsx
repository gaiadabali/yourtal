"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FeedItem as FeedItemData } from "@yourtal/contracts/feed";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { VerticalFeedVideo } from "@yourtal/ui/vertical-feed/video";
import { earnsInFeed, feedTermsLine, type FeedLocale } from "./feed-terms";
import { FeedItemActions } from "./feed-item-actions";
import { QuickEarnAction, QuickEarnVideo } from "./quick-earn";
import { useQuickEarn } from "./use-quick-earn";

export interface FeedItemProps {
  item: FeedItemData;
  locale: FeedLocale;
  active: boolean;
  mounted: boolean;
  /** Autoplay setting says no teaser video right now; show the poster instead. */
  postersOnly: boolean;
  saved: boolean;
  /** Absolute URL of the public campaign page, for Share. */
  shareUrl: string;
  onHidden: (campaignId: string) => void;
}

/** One For You item: the teaser full-bleed, honest terms before any action, and a right rail. */
export function FeedItem({
  item,
  locale,
  active,
  mounted,
  postersOnly,
  saved,
  shareUrl,
  onHidden,
}: FeedItemProps) {
  const t = useTranslations("feed");
  const earn = useQuickEarn(item.campaignId);
  const [isSaved, setIsSaved] = useState(saved);
  const inFeed = earnsInFeed(item);

  return (
    <article
      aria-label={t("item.label", { merchantName: item.merchantName, title: item.title })}
      className="relative h-full w-full overflow-hidden bg-black"
    >
      <VerticalFeedVideo
        mounted={mounted && !postersOnly}
        active={active}
        src={item.teaserUrl}
        poster={item.posterUrl}
        posterAlt=""
        label={item.title}
        playLabel={t("item.play", { title: item.title })}
        pauseLabel={t("item.pause", { title: item.title })}
        muted
        loop
      />
      {inFeed ? <QuickEarnVideo earn={earn} title={item.title} active={active} /> : null}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-overlay to-transparent"
      />

      <div className="absolute right-2 bottom-24 z-20">
        <FeedItemActions
          item={item}
          saved={isSaved}
          onSavedChange={setIsSaved}
          shareUrl={shareUrl}
          onHidden={onHidden}
        />
      </div>

      <div className="absolute inset-x-3 bottom-4 z-20 flex max-w-[calc(100%-4.5rem)] flex-col gap-2 text-white">
        <div className="flex w-fit items-center gap-2">
          <a href={`/c/${item.channelHandle}`} className="flex items-center gap-2">
            <ChannelAvatar
              decorative
              name={item.merchantName}
              size="sm"
              {...(item.channelLogoUrl ? { src: item.channelLogoUrl } : {})}
            />
            <span className="text-label font-sans font-semibold">{item.merchantName}</span>
          </a>
          {/* 12.4.d/#9: every campaign is a brand's paid video, so every card
              says so in text. 13.23.f (F90): a boosted one says "Sponsored". */}
          <Badge variant="outline" className="border-white/70 text-white">
            {item.boosted ? t("item.sponsored") : t("item.brandVideo")}
          </Badge>
        </div>
        <h2 className="line-clamp-2 font-display text-title font-bold text-balance">
          {item.title}
        </h2>
        <p className="text-caption font-sans">{feedTermsLine(t, locale, item)}</p>
        {inFeed ? (
          <QuickEarnAction earn={earn} rewardPoints={item.rewardPoints} locale={locale} />
        ) : (
          <div>
            <Button asChild size="lg">
              <a href={`/watch/${item.campaignId}`}>{t("item.watchAndEarn")}</a>
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
