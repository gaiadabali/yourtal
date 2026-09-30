"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@yourtal/ui/segmented-control";
import { VerticalFeed } from "@yourtal/ui/vertical-feed";
import {
  isCellularConnection,
  readNavigatorConnection,
} from "@/features/player/network-connection";
import type { HomeFeedData } from "./feed-data";
import { FeedItem } from "./feed-item";
import { FeedRow } from "./feed-row";
import { StreakStrip } from "./streak-strip";
import { WatchTimeReminder } from "./watch-time-reminder";
import { useWatchTimeReminder } from "./use-watch-time-reminder";
import { formatFeedPoints, type FeedLocale } from "./feed-terms";

type Tab = "forYou" | "continue" | "saved" | "following" | "endingSoon";
type RowKey = Exclude<Tab, "forYou">;
const ALL_ROW_KEYS: readonly RowKey[] = ["continue", "saved", "following", "endingSoon"];

export interface HomeFeedProps {
  data: HomeFeedData;
  locale: FeedLocale;
  /** e.g. "https://yourtal.com/au": Share links point at the public campaign page. */
  publicBase: string;
}

export function HomeFeed({ data, locale, publicBase }: HomeFeedProps) {
  const t = useTranslations("feed");
  const [tab, setTab] = useState<Tab>("forYou");
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

  const feed = (
    <VerticalFeed
      items={items.map((item) => ({ ...item, id: item.campaignId }))}
      mode="teaser"
      label={t("feedLabel")}
      preloadSrc={(item) => (postersOnly ? undefined : item.teaserUrl)}
      className="h-full"
      endSlot={
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="font-display text-headline text-fg">{t("end.caughtUp")}</p>
          <p className="text-body font-sans text-fg-muted">
            {t("end.earnedToday", { points: formatFeedPoints(locale, data.earnedToday) })}
          </p>
        </div>
      }
      renderItem={(item, state) => (
        <FeedItem
          item={item}
          locale={locale}
          active={state.active}
          mounted={state.mounted}
          postersOnly={postersOnly}
          saved={saved.has(item.campaignId)}
          shareUrl={`${publicBase}/c/${item.campaignId}`}
          onHidden={(id) => setHidden((current) => new Set(current).add(id))}
        />
      )}
    />
  );

  // 12.2.b: no streak counter for a teen, anywhere -- the whole strip is
  // streak-first UI (days count, pending-grant dates framed against it), so
  // it does not render at all rather than showing a half-empty version.
  const isTeen = data.ageBand === "teen";
  // 12.4.d/#7: no "Ending soon" row or tab for a teen -- the ranking side
  // (`ranking.ts`'s own `signalsFor`) already never flags an item ending
  // soon for a teen viewer, so `data.rows.endingSoon` is always empty for
  // one; this drops the row and its tab entirely rather than showing an
  // empty shelf.
  const rowKeys = isTeen ? ALL_ROW_KEYS.filter((key) => key !== "endingSoon") : ALL_ROW_KEYS;
  // Explicitly typed: a bare `["forYou", ...rowKeys]` widens to `string[]`
  // (no `Tab` left for `SegmentedControl`'s own generic to infer), since
  // `rowKeys` is a plain runtime array, not a literal tuple.
  const tabs: readonly Tab[] = ["forYou", ...rowKeys];
  const rows = rowKeys.map((key) => (
    <FeedRow
      key={key}
      title={t(`rows.${key}`)}
      empty={t(`rowEmpty.${key}`)}
      items={data.rows[key]}
      locale={locale}
    />
  ));

  // 12.2.b: a gentle nudge after ~45 continuous foreground minutes in the
  // feed -- teen-only, same as the rest of this section's softer engagement.
  const watchTimeReminder = useWatchTimeReminder(isTeen);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex flex-col gap-3 lg:hidden">
        {watchTimeReminder.show ? (
          <WatchTimeReminder onDismiss={watchTimeReminder.dismiss} />
        ) : null}
        {isTeen ? null : (
          <StreakStrip days={data.streakDays} pending={data.pending} locale={locale} />
        )}
        <SegmentedControl
          label={t("tabs.label")}
          value={tab}
          onChange={setTab}
          options={tabs.map((value) => ({
            value,
            label: t(`tabs.${value}`),
          }))}
          className="overflow-x-auto"
        />
      </div>

      <div
        className={`${tab === "forYou" ? "block" : "hidden"} h-[calc(100dvh-16rem)] w-full overflow-hidden rounded-card lg:block lg:h-[calc(100dvh-7rem)] lg:w-[420px] lg:shrink-0`}
      >
        {feed}
      </div>

      {tab === "forYou" || !rowKeys.includes(tab) ? null : (
        <div className="lg:hidden">{rows[rowKeys.indexOf(tab)]}</div>
      )}

      <div className="hidden min-w-0 flex-1 flex-col gap-6 lg:flex">
        {watchTimeReminder.show ? (
          <WatchTimeReminder onDismiss={watchTimeReminder.dismiss} />
        ) : null}
        {isTeen ? null : (
          <StreakStrip days={data.streakDays} pending={data.pending} locale={locale} />
        )}
        {rows}
      </div>
    </div>
  );
}
