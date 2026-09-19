import type { Campaign } from "@yourtal/contracts/campaign";
import { Card, CardContent } from "@yourtal/ui/card";
import {
  describeQuestionCount,
  describeScoringRule,
} from "@/features/campaign/campaign-scoring-copy";
import { getPublicTranslator } from "./public-i18n";
import { PublicFact } from "./public-fact";
import { PublicCtaLink } from "./public-cta-link";
import { computeCampaignRewardFacts } from "./public-reward-facts";
import type { PublicLocaleConfig } from "./public-locale";

export interface PublicCampaignContentProps {
  campaign: Campaign;
  locale: PublicLocaleConfig;
  merchantHref: string;
}

/**
 * The public campaign landing page's body (YT-0431). Mirrors the fact set
 * `CampaignEntryCard` (`apps/web/features/campaign/campaign-entry-card.tsx`)
 * shows a logged-in user — duration, data cost, base reward, accuracy
 * bonus, question count, scoring rule — reusing its pure formatters
 * (`campaign-format.ts`, `campaign-reward-split.ts`, `campaign-scoring-copy.ts`
 * via `public-reward-facts.ts`) rather than rebuilding them, per this
 * ticket's brief. What is different on purpose:
 *
 * - No "Start video" action. Open Viewing (YT-0432, anonymous full
 *   playback) is not built yet, so this page does not promise a playback
 *   experience that does not exist — the single action here is signing up,
 *   named honestly against the actual reward and duration
 *   (`public-reward-facts.ts`).
 * - A campaign that is not `status === "active"` still gets a real page
 *   (`public-campaign-data.ts`'s `listPublicCampaigns` keeps every status in
 *   `generateStaticParams`, docs/11-seo-aeo-geo.md §2.3's "never 404 a
 *   previously-indexed page" principle) but shows a plain notice instead of
 *   the reward facts and sign-up call to action, which would otherwise
 *   advertise a reward that is no longer obtainable — the CTA promise stays
 *   honest by not being shown at all rather than being shown stale.
 */
export function PublicCampaignContent({
  campaign,
  locale,
  merchantHref,
}: PublicCampaignContentProps) {
  const t = getPublicTranslator(locale.intlLocale);
  const isLive = campaign.status === "active";

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-fg-subtle">{t("campaign.eyebrow")}</p>
          <a href={merchantHref} className="text-xs text-fg-subtle hover:underline">
            {campaign.merchantName}
          </a>
          <h1 className="text-xl font-semibold text-fg">{campaign.title}</h1>
          <p className="text-sm text-fg-muted">{campaign.synopsis}</p>
        </header>

        {isLive ? (
          <PublicCampaignLiveFacts campaign={campaign} locale={locale} />
        ) : (
          <p className="rounded-md bg-surface-raised px-3 py-2 text-sm text-fg-muted">
            {t("campaign.notLiveNotice")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface PublicCampaignLiveFactsProps {
  campaign: Campaign;
  locale: PublicLocaleConfig;
}

/** The reward facts and sign-up call to action — only ever rendered for a currently live campaign. */
function PublicCampaignLiveFacts({ campaign, locale }: PublicCampaignLiveFactsProps) {
  const t = getPublicTranslator(locale.intlLocale);
  const facts = computeCampaignRewardFacts(campaign, locale);

  return (
    <>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PublicFact label={t("campaign.durationLabel")} value={facts.durationLabel} />
        <PublicFact label={t("campaign.dataCostLabel")} value={facts.dataCostLabel} />
        <PublicFact
          label={t("campaign.rewardLabel")}
          value={facts.baseRewardLabel}
          valueClassName="text-reward"
        />
        {facts.accuracyBonusLabel !== null ? (
          <PublicFact
            label={t("campaign.accuracyBonusLabel")}
            value={facts.accuracyBonusLabel}
            valueClassName="text-reward"
          />
        ) : null}
        <PublicFact
          label={t("campaign.questionsLabel")}
          value={describeQuestionCount(campaign.questionCount, locale.intlLocale)}
        />
        <PublicFact
          label={t("campaign.scoringLabel")}
          value={describeScoringRule(campaign.scoringRule, locale.intlLocale)}
        />
      </dl>

      <div className="flex flex-col gap-2 rounded-md bg-surface px-3 py-3">
        <p className="text-sm font-medium text-fg">{t("campaign.ctaHeading")}</p>
        <p className="text-sm text-fg-muted">
          {facts.accuracyBonusLabel === null
            ? t("campaign.ctaBody", {
                duration: facts.durationLabel,
                reward: facts.baseRewardLabel,
              })
            : t("campaign.ctaBodyWithBonus", {
                duration: facts.durationLabel,
                reward: facts.baseRewardLabel,
                bonus: facts.accuracyBonusLabel,
              })}
        </p>
      </div>

      <p className="text-xs text-fg-subtle">{t("campaign.honestyNote")}</p>

      <PublicCtaLink href="/onboarding">{t("campaign.ctaButton")}</PublicCtaLink>
    </>
  );
}
