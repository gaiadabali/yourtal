import type { Campaign } from "@yourtal/contracts/campaign";
import { computeCampaignRewardFacts } from "@/features/public/public-reward-facts";
import { getPublicTranslator } from "@/features/public/public-i18n";
import type { PublicLocaleConfig } from "@/features/public/public-locale";

export interface OpenViewCopy {
  breadcrumbLabel: string;
  eyebrow: string;
  foregoneRewardNotice: string;
  signupLinkLabel: string;
  finishedHeading: string;
  finishedBody: string;
  signupCta: string;
  chapterWatchedStatus: string;
  chapterWatchingStatus: string;
  chapterUpcomingStatus: string;
}

/**
 * Every user-facing string `OpenViewPlayer` (a "use client" leaf, YT-0432)
 * needs, computed once here on the server and passed down as plain prop
 * strings — the same split `public-campaign-content.tsx` already uses for
 * its own reward copy. Keeps next-intl's translator entirely server-side:
 * the `(public)` route group mounts no `NextIntlClientProvider` (YT-0405's
 * provider lives only in `app/(app)/layout.tsx`, off limits to this
 * feature), so a client component here has no ambient way to translate
 * itself.
 *
 * Reuses `computeCampaignRewardFacts` rather than re-deriving the reward
 * split, and reproduces its exact base/bonus honesty rule
 * (`campaign-reward-split.ts`: never combine base + accuracy bonus into one
 * inflated number) for the "here's what you would have earned" copy —
 * `*WithBonus` variants exist for that reason, not just to fill more
 * message keys.
 */
export function computeOpenViewCopy(campaign: Campaign, locale: PublicLocaleConfig): OpenViewCopy {
  const t = getPublicTranslator(locale.intlLocale);
  const facts = computeCampaignRewardFacts(campaign, locale);

  const foregoneRewardNotice =
    facts.accuracyBonusLabel === null
      ? t("openView.foregoneRewardNotice", { reward: facts.baseRewardLabel })
      : t("openView.foregoneRewardNoticeWithBonus", {
          reward: facts.baseRewardLabel,
          bonus: facts.accuracyBonusLabel,
        });

  const finishedBody =
    facts.accuracyBonusLabel === null
      ? t("openView.finishedBody", { reward: facts.baseRewardLabel })
      : t("openView.finishedBodyWithBonus", {
          reward: facts.baseRewardLabel,
          bonus: facts.accuracyBonusLabel,
        });

  return {
    breadcrumbLabel: t("openView.breadcrumbLabel"),
    eyebrow: t("openView.eyebrow"),
    foregoneRewardNotice,
    signupLinkLabel: t("openView.signupLinkLabel"),
    finishedHeading: t("openView.finishedHeading"),
    finishedBody,
    signupCta: t("openView.signupCta"),
    chapterWatchedStatus: t("openView.chapterWatchedStatus"),
    chapterWatchingStatus: t("openView.chapterWatchingStatus"),
    chapterUpcomingStatus: t("openView.chapterUpcomingStatus"),
  };
}
