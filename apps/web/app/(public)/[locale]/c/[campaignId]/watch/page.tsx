import type { Metadata } from "next";
import type { Campaign } from "@yourtal/contracts/campaign";
import { notFound } from "next/navigation";
import { playerChapters } from "@/features/player/player-chapters";
import { computeOpenViewCopy } from "@/features/open-view/open-view-copy";
import { OpenViewSessionGate } from "@/features/open-view/open-view-session-gate";
import {
  getPublicCampaignForLocale,
  getPublicCampaignTermsFromApi,
  listLivePublicCampaigns,
} from "@/features/public/public-campaign-data";
import type { PublicLocale } from "@/features/public/public-locale";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { slugify } from "@/features/public/public-slug";

/**
 * `/[locale]/c/[campaignId]/watch` — Open Viewing (F8, TASKS.md 11.2.b):
 * anonymous full playback, no account, no reward UI, gated to a campaign
 * that is live, has opted into `openViewing`, AND is rated `all_ages` — the
 * same three conditions `campaign_view.yaml`'s `open-viewing-is-opt-in-and-
 * funded` rule (plus its own funding check) enforces server-side for the
 * anonymous session itself (`open-view-session.controller.ts`). This page
 * is the honest front door to that: a campaign failing any of the three
 * never gets this route at all, mirroring `public-campaign-content.tsx`'s
 * own "no call to action for a non-eligible campaign" rule.
 *
 * `dynamicParams = true` (11.2.b, was `false`): a real, seeded campaign —
 * reached from the live anonymous feed or the public campaign page, same as
 * `../page.tsx`'s own 11.2.a note — is not in the fixed mock catalogue
 * `generateStaticParams` below enumerates, and would otherwise 404 outright.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listLivePublicCampaigns(locale)
      .filter(isOpenViewEligible)
      .map((campaign) => ({ locale, campaignId: campaign.id })),
  );
}

export const dynamicParams = true;
export const revalidate = 60;

interface OpenViewWatchPageProps {
  params: Promise<{ locale: string; campaignId: string }>;
}

function isOpenViewEligible(campaign: Campaign): boolean {
  return campaign.status === "active" && campaign.openViewing && campaign.audience === "all_ages";
}

async function requireEligibleCampaign(campaignId: string, locale: PublicLocale): Promise<Campaign> {
  const campaign = await getPublicCampaignForLocale(campaignId, locale);
  if (!campaign || !isOpenViewEligible(campaign)) {
    notFound();
  }
  return campaign;
}

export async function generateMetadata({ params }: OpenViewWatchPageProps): Promise<Metadata> {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = await requireEligibleCampaign(campaignId, locale);
  const url = publicUrl(locale, `/c/${campaign.id}/watch`);

  return {
    title: `${campaign.title} — ${campaign.merchantName} | YourTal`,
    description: campaign.synopsis,
    alternates: { canonical: url },
    // Deliberately no custom `opengraph-image.tsx` for this action page:
    // the parent `/c/[campaignId]` page's own OG card already carries the
    // one honest reward/duration claim docs/11-seo-aeo-geo.md section 5
    // cares about, and this route is reached by clicking through that
    // page, never shared as a link on its own — duplicating the card here
    // would be ceremony with no reader benefit.
  };
}

export default async function OpenViewWatchPage({ params }: OpenViewWatchPageProps) {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = await requireEligibleCampaign(campaignId, locale);

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const chapters = playerChapters(campaign);
  // Real terms only exist for a seeded (API) campaign, never the fixed mock
  // catalogue — `undefined` there is expected, not an error (11.5.a).
  const terms = await getPublicCampaignTermsFromApi(campaignId);
  const copy = computeOpenViewCopy(campaign, terms?.accuracyBonusPoints ?? 0, config);
  const merchantSlug = slugify(campaign.merchantName);

  return (
    <>
      <PublicBreadcrumbs
        navAriaLabel={t("breadcrumbNav.ariaLabel")}
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: campaign.merchantName, url: publicUrl(locale, `/m/${merchantSlug}`) },
          { name: campaign.title, url: publicUrl(locale, `/c/${campaign.id}`) },
          { name: copy.breadcrumbLabel, url: publicUrl(locale, `/c/${campaign.id}/watch`) },
        ]}
      />
      <OpenViewSessionGate
        campaign={campaign}
        chapters={chapters}
        copy={copy}
        locale={config.intlLocale}
      />
    </>
  );
}
