import { CampaignEntryCardSkeleton } from "@/features/campaign/campaign-entry-card-skeleton";

/** Loading state for the campaign entry card (YT-0411). */
export default function CampaignEntryLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <CampaignEntryCardSkeleton />
    </div>
  );
}
