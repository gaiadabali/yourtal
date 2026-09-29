import type { FeedItem } from "@yourtal/contracts/feed";
import { asDisplayPoints, formatPointsIn } from "@yourtal/contracts/money/format";

export type FeedLocale = "en-AU" | "id-ID";

/** The subset of a next-intl translator this module needs, so it stays testable. */
export type FeedTermsTranslator = (key: string, values?: Record<string, string | number>) => string;

export function formatFeedPoints(locale: FeedLocale, points: number): string {
  return formatPointsIn(locale, asDisplayPoints(points));
}

/** Whole minutes rounded up, so "18 min" never understates how long it takes. */
export function formatFeedDuration(t: FeedTermsTranslator, seconds: number): string {
  return seconds < 60
    ? t("terms.seconds", { count: seconds })
    : t("terms.minutes", { count: Math.ceil(seconds / 60) });
}

export interface FeedTermsInput {
  readonly kind: FeedItem["kind"];
  readonly durationSeconds: number;
  readonly questionCount: number;
  readonly rewardPoints: number;
  readonly maxRewardPoints: number;
  readonly estimatedDataMb: number;
}

/**
 * The honest terms line shown before any action (11.4.a), e.g.
 * "18 min · 3 questions · up to 112 pts · ~120 MB · finish to earn".
 * Quick campaigns ask no questions (F15), so they carry no bonus either.
 */
export function feedTermsLine(
  t: FeedTermsTranslator,
  locale: FeedLocale,
  item: FeedTermsInput,
): string {
  const parts = [formatFeedDuration(t, item.durationSeconds)];
  if (item.kind === "quick" || item.questionCount === 0) {
    parts.push(formatFeedPoints(locale, item.rewardPoints));
  } else {
    parts.push(t("terms.questions", { count: item.questionCount }));
    parts.push(t("terms.upTo", { points: formatFeedPoints(locale, item.maxRewardPoints) }));
  }
  parts.push(t("terms.data", { mb: Math.max(1, Math.round(item.estimatedDataMb)) }));
  parts.push(t("terms.finishToEarn"));
  return parts.join(" · ");
}

/** Quick campaigns earn inside the feed (F15); everything else opens the full player. */
export function earnsInFeed(item: Pick<FeedItem, "kind" | "durationSeconds">): boolean {
  return item.kind === "quick" && item.durationSeconds < 60;
}
