import type { Campaign } from "@yourtal/contracts/campaign";
import { computeCampaignRewardFacts } from "@/features/public/public-reward-facts";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { getPlayerTranslator } from "@/features/player/player-i18n";
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
  /** For the shared `PlayerControls`/`SeekSlider` primitives this feature reuses (6.1.d) — computed here, same as every other field, never read ambiently. */
  playAriaLabel: string;
  /** 13.9.e: the CC toggle and the caption track. */
  captionsLabel: string;
  playingStatus: string;
  pausedStatus: string;
  chaptersAriaLabel: string;
  /** 11.2.b: the anonymous-session gate's own states — starting, and each way it can be refused. */
  startingLabel: string;
  dailyLimitHeading: string;
  dailyLimitBody: string;
  concurrentSessionHeading: string;
  concurrentSessionBody: string;
  startFailedHeading: string;
  startFailedBody: string;
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
 * split, and reproduces its exact base/bonus honesty rule (11.5.a: never
 * combine base + accuracy bonus into one inflated number, and never invent
 * the bonus either) for the "here's what you would have earned" copy —
 * `*WithBonus` variants exist for that reason, not just to fill more
 * message keys.
 */
export function computeOpenViewCopy(
  campaign: Campaign,
  /** This campaign's real `CampaignTerms.accuracyBonusPoints` — `0` when the caller has no terms to read. */
  accuracyBonusPoints: number,
  locale: PublicLocaleConfig,
): OpenViewCopy {
  const t = getPublicTranslator(locale.intlLocale);
  const tPlayer = getPlayerTranslator(locale.intlLocale);
  const facts = computeCampaignRewardFacts(campaign, accuracyBonusPoints, locale);

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
    playAriaLabel: tPlayer("controls.playCampaign", { title: campaign.title }),
    captionsLabel: tPlayer("controls.captions"),
    playingStatus: tPlayer("status.playing"),
    pausedStatus: tPlayer("status.paused"),
    chaptersAriaLabel: tPlayer("chapters.ariaLabel"),
    startingLabel: t("openView.startingLabel"),
    dailyLimitHeading: t("openView.dailyLimitHeading"),
    dailyLimitBody: t("openView.dailyLimitBody"),
    concurrentSessionHeading: t("openView.concurrentSessionHeading"),
    concurrentSessionBody: t("openView.concurrentSessionBody"),
    startFailedHeading: t("openView.startFailedHeading"),
    startFailedBody: t("openView.startFailedBody"),
  };
}
