import { notFound } from "next/navigation";
import { CampaignEntryCard } from "@/features/campaign/campaign-entry-card";
import { getCampaign } from "@/features/campaign/campaign-data";
import { getDisplayLocale } from "@/i18n/get-locale";

/**
 * The campaign entry card (YT-0411) — `/campaign/[campaignId]`, the
 * product's honesty claim (docs/06-longform-video-and-attention.md §3).
 * Server Component per docs/13b-typescript-standards.md §8; the card itself
 * has no interactive state, so nothing here needs `"use client"`.
 */
export default async function CampaignEntryPage(props: PageProps<"/campaign/[campaignId]">) {
  const { campaignId } = await props.params;
  const [campaign, locale] = await Promise.all([getCampaign(campaignId), getDisplayLocale()]);

  if (!campaign) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      {/* No terms are read here, so no bonus is shown rather than a made-up
          split; `/watch/[campaignId]` reads the genuine terms. */}
      <CampaignEntryCard campaign={campaign} accuracyBonusPoints={0} locale={locale} />
    </div>
  );
}
