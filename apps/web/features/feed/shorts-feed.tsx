"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { VerticalFeed } from "@yourtal/ui/vertical-feed";
import {
  isCellularConnection,
  readNavigatorConnection,
} from "@/features/player/network-connection";
import type { ShortsFeedData } from "./feed-data";
import { FeedItem } from "./feed-item";
import { WatchTimeReminder } from "./watch-time-reminder";
import { useWatchTimeReminder } from "./use-watch-time-reminder";
import { formatFeedPoints, type FeedLocale } from "./feed-terms";
import { SHORTS_SIGN_UP_HREF } from "./shorts-signup-href";

export interface ShortsFeedProps {
  data: ShortsFeedData;
  locale: FeedLocale;
  /** e.g. "https://yourtal.com/au": Share links point at the public campaign page. */
  publicBase: string;
}

/**
 * Shorts (13.14.a): one vertical swipe feed, centred, earning in place. The
 * lists that used to sit beside it moved to Home, and the streak to the header.
 */
export function ShortsFeed({ data, locale, publicBase }: ShortsFeedProps) {
  const t = useTranslations("feed");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const items = useMemo(
    () => data.items.filter((item) => !hidden.has(item.campaignId)),
    [data.items, hidden],
  );
  const saved = useMemo(() => new Set(data.savedIds), [data.savedIds]);

  // 11.4.f: the Me autoplay setting holds here. The connection is read after
  // hydration so server and client render the same first frame.
  const [postersOnly, setPostersOnly] = useState(data.autoplay === "never");
  useEffect(() => {
    if (data.autoplay === "wifi_only" && isCellularConnection(readNavigatorConnection())) {
      setPostersOnly(true);
    }
  }, [data.autoplay]);

  // 12.2.b: a gentle nudge after ~45 continuous minutes, teens only.
  const watchTimeReminder = useWatchTimeReminder(data.ageBand === "teen");

  return (
    // The card is sized to what is left of the window after the top bar, the page's padding and,
    // on staging, the banner (`--staging-banner-h`), so the Earn button never sits below the fold.
    <div className="mx-auto flex w-full max-w-[440px] flex-col gap-3">
      {watchTimeReminder.show ? <WatchTimeReminder onDismiss={watchTimeReminder.dismiss} /> : null}
      <div className="h-[calc(100dvh-10rem-var(--staging-banner-h,0px))] w-full overflow-hidden rounded-card bg-black lg:h-[calc(100dvh-6rem-var(--staging-banner-h,0px))]">
        <VerticalFeed
          items={items.map((item) => ({ ...item, id: item.campaignId }))}
          mode="teaser"
          label={t("feedLabel")}
          preloadSrc={(item) => (postersOnly ? undefined : item.teaserUrl)}
          className="h-full"
          endSlot={
            // The feed sits on black in both themes, so the card's text is fixed white: the theme's
            // text colours turn dark grey on black in light mode (V10).
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-white">
              <p className="font-display text-headline">{t("end.caughtUp")}</p>
              {data.signedOut ? (
                <>
                  <p className="text-body font-sans text-white/80">{t("end.signUpBody")}</p>
                  <Button asChild size="lg">
                    <a href={SHORTS_SIGN_UP_HREF}>{t("item.signUpToEarn")}</a>
                  </Button>
                </>
              ) : (
                <p className="text-body font-sans text-white/80">
                  {t("end.earnedToday", { points: formatFeedPoints(locale, data.earnedToday) })}
                </p>
              )}
            </div>
          }
          renderItem={(item, state) => (
            <FeedItem
              item={item}
              locale={locale}
              active={state.active}
              mounted={state.mounted}
              postersOnly={postersOnly}
              priority={state.index === 0}
              saved={saved.has(item.campaignId)}
              signedOut={data.signedOut}
              shareUrl={`${publicBase}/c/${item.campaignId}`}
              onHidden={(id) => setHidden((current) => new Set(current).add(id))}
            />
          )}
        />
      </div>
    </div>
  );
}
