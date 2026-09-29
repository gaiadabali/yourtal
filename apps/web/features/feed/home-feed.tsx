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
import { formatFeedPoints, type FeedLocale } from "./feed-terms";

type Tab = "forYou" | "continue" | "saved" | "following" | "endingSoon";
type RowKey = Exclude<Tab, "forYou">;
const ROW_KEYS: readonly RowKey[] = ["continue", "saved", "following", "endingSoon"];

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

  const rows = ROW_KEYS.map((key) => (
    <FeedRow
      key={key}
      title={t(`rows.${key}`)}
      empty={t(`rowEmpty.${key}`)}
      items={data.rows[key]}
      locale={locale}
    />
  ));

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex flex-col gap-3 lg:hidden">
        <StreakStrip days={data.streakDays} pending={data.pending} locale={locale} />
        <SegmentedControl
          label={t("tabs.label")}
          value={tab}
          onChange={setTab}
          options={(["forYou", ...ROW_KEYS] as const).map((value) => ({
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

      {tab === "forYou" ? null : <div className="lg:hidden">{rows[ROW_KEYS.indexOf(tab)]}</div>}

      <div className="hidden min-w-0 flex-1 flex-col gap-6 lg:flex">
        <StreakStrip days={data.streakDays} pending={data.pending} locale={locale} />
        {rows}
      </div>
    </div>
  );
}
