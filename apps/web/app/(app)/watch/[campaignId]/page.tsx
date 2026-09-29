import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWatchCampaign } from "@/features/player/get-watch-campaign";
import { TermsCard } from "@/features/player/terms-card";
import { VideoPlayer } from "@/features/player/video-player";
import { getDisplayLocale } from "@/i18n/get-locale";

interface WatchPageProps {
  params: Promise<{ campaignId: string }>;
}

export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  const { campaignId } = await params;
  const found = await getWatchCampaign(campaignId);
  if (found === null) {
    return { title: "YourTal" };
  }
  return {
    title: `${found.campaign.title} · YourTal`,
    description: found.campaign.synopsis,
  };
}

// Server Component per docs/13b-typescript-standards.md §8: fetches the
// campaign and its current terms (11.5.a), then hands both to the client
// leaf (`VideoPlayer`) as plain, serializable props. No "use client" here.
export default async function WatchPage({ params }: WatchPageProps) {
  const { campaignId } = await params;
  const found = await getWatchCampaign(campaignId);
  if (found === null) {
    notFound();
  }
  const { campaign, terms } = found;
  const locale = await getDisplayLocale();

  return (
    // A plain `<div>`, not `<main>`: `viewer-shell.tsx` already renders the
    // page's one `<main>` landmark (axe's landmark-no-duplicate-main).
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-sans font-semibold text-fg">{campaign.title}</h1>
        <p className="text-sm font-sans text-fg-muted">{campaign.merchantName}</p>
      </header>
      <VideoPlayer campaign={campaign} terms={terms} locale={locale} />
      <TermsCard terms={terms} locale={locale} />
    </div>
  );
}
