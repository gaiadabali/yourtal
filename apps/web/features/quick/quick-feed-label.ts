import { getQuickTranslator, type SupportedLocale } from "./quick-i18n";

export interface QuickFeedItemLabelParams {
  merchantName: string;
  title: string;
  /** 1-based position in the feed. */
  position: number;
  total: number;
  /** No default (6.1.c) — a caller that forgets this must fail to compile. */
  locale: SupportedLocale;
}

/**
 * Builds the screen-reader "where am I in the feed" status
 * (docs/tasks/phase-u-ui.md YT-0414: "Screen-reader users need to know
 * where they are in the feed"), e.g. "Video 3 dari 12: Toko ABC — Promo
 * Kilat" / "Video 3 of 12: Toko ABC — Promo Kilat". Kept as a pure function,
 * separate from `quick-feed-viewport.tsx` (the client leaf that reads it
 * back off a `data-*` attribute), so the copy itself is unit-testable
 * without mounting React or an IntersectionObserver.
 */
export function buildQuickFeedItemLabel({
  merchantName,
  title,
  position,
  total,
  locale,
}: QuickFeedItemLabelParams): string {
  const t = getQuickTranslator(locale);
  return t("feedLabel", { position, total, merchantName, title });
}
