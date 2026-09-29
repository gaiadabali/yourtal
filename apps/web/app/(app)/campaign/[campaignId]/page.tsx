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
      {/* This route is still Phase U's mock-only data source (`campaign-data.ts`'s
          `liveDataSource` rejects) — there is no real `CampaignTerms` row to
          read a bonus from here, so 0 is passed rather than a fabricated
          split (11.5.a deleted `campaign-reward-split.ts`'s 60/40 ratio for
          exactly this reason). The real entry point for a live campaign is
          `/watch/[campaignId]` (`get-watch-campaign.ts`), which reads the
          genuine terms. */}
      <CampaignEntryCard campaign={campaign} accuracyBonusPoints={0} locale={locale} />
    </div>
  );
}
