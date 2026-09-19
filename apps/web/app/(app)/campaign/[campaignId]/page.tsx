import { notFound } from "next/navigation";
import { CampaignEntryCard } from "@/features/campaign/campaign-entry-card";
import { getCampaign } from "@/features/campaign/campaign-data";

/**
 * The campaign entry card (YT-0411) — `/campaign/[campaignId]`, the
 * product's honesty claim (docs/06-longform-video-and-attention.md §3).
 * Server Component per docs/13b-typescript-standards.md §8; the card itself
 * has no interactive state, so nothing here needs `"use client"`.
 */
export default async function CampaignEntryPage(props: PageProps<"/campaign/[campaignId]">) {
  const { campaignId } = await props.params;
  const campaign = await getCampaign(campaignId);

  if (!campaign) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <CampaignEntryCard campaign={campaign} />
    </div>
  );
}
