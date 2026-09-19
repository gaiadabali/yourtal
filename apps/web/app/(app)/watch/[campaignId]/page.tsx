import type { Metadata } from "next";
import { deriveChapters } from "@/features/player/derive-chapters";
import { getWatchCampaign } from "@/features/player/get-watch-campaign";
import { VideoPlayer } from "@/features/player/video-player";

interface WatchPageProps {
  params: Promise<{ campaignId: string }>;
}

export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  const { campaignId } = await params;
  const campaign = getWatchCampaign(campaignId);
  return {
    title: `${campaign.title} · YourTal`,
    description: campaign.synopsis,
  };
}

// Server Component per docs/13b-typescript-standards.md §8: fetches the
// campaign and derives its chapters, then hands both to the client leaf
// (`VideoPlayer`) as plain, serializable props. No "use client" here.
export default async function WatchPage({ params }: WatchPageProps) {
  const { campaignId } = await params;
  const campaign = getWatchCampaign(campaignId);
  const chapters = deriveChapters(campaign);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-sans font-semibold text-fg">{campaign.title}</h1>
        <p className="text-sm font-sans text-fg-muted">{campaign.merchantName}</p>
      </header>
      <VideoPlayer campaign={campaign} chapters={chapters} />
    </main>
  );
}
