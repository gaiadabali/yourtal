import type { FeedItem } from "@yourtal/contracts/feed";
import { formatDataCost, formatDuration } from "@/features/campaign/campaign-format";
import { describeQuestionCount } from "@/features/campaign/campaign-scoring-copy";
import { getPublicTranslator } from "./public-i18n";
import type { PublicLocaleConfig } from "./public-locale";

/**
 * The honest terms line for a logged-out feed teaser (11.1.b, F12), the
 * same fact set 11.4.a's signed-in card shows — "18 min · 3 questions ·
 * up to 112 pts · ~120 MB · finish to earn" — built from `FeedItem`'s own
 * `maxRewardPoints`/`questionCount`/`estimatedDataMb` (F78) rather than a
 * second copy of that math. `maxRewardPoints` is base + the maximum
 * accuracy bonus: what "up to" means, and the only honest number to show
 * a viewer who has not started watching yet.
 */
export function describeFeedItemTerms(item: FeedItem, locale: PublicLocaleConfig): string {
  const t = getPublicTranslator(locale.intlLocale);
  // Pre-formatted, not a raw number handed to `t()` — same convention
  // `top-bar.tsx`'s `pointsAvailable` interpolation uses, so points always
  // get this locale's own thousands grouping.
  const points = new Intl.NumberFormat(locale.intlLocale).format(item.maxRewardPoints);
  const parts = [
    formatDuration(item.durationSeconds, locale.intlLocale),
    describeQuestionCount(item.questionCount, locale.intlLocale),
    t("feed.upToPoints", { points }),
    formatDataCost(item.estimatedDataMb, locale.intlLocale),
    t("feed.finishToEarn"),
  ];
  return parts.join(" · ");
}
