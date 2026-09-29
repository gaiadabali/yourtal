import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChannelRow } from "@/features/player/channel-row";
import { isFollowingBusiness } from "@/features/player/follow-actions";
import { getWatchCampaign } from "@/features/player/get-watch-campaign";
import { getWatchChannel } from "@/features/player/get-watch-channel";
import { MoreFromChannel } from "@/features/player/more-from-channel";
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
  const [locale, channelData, isFollowing] = await Promise.all([
    getDisplayLocale(),
    getWatchChannel(campaign.businessId),
    isFollowingBusiness(campaign.businessId),
  ]);

  // `channelData` is `null` only on a lookup failure (business not found,
  // suspended, or the API unreachable) — the player and terms card still
  // render either way; only the channel-specific pieces disappear.
  const otherCampaigns =
    channelData?.campaigns.filter((candidate) => candidate.id !== campaign.id) ?? [];
  const upNext = otherCampaigns[0] ?? null;

  return (
    // A plain `<div>`, not `<main>`: `viewer-shell.tsx` already renders the
    // page's one `<main>` landmark (axe's landmark-no-duplicate-main).
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-sans font-semibold text-fg">{campaign.title}</h1>
        <p className="text-sm font-sans text-fg-muted">{campaign.merchantName}</p>
      </header>
      <VideoPlayer
        campaign={campaign}
        terms={terms}
        locale={locale}
        upNext={upNext}
        vouchers={channelData?.listings ?? []}
      />
      {channelData !== null ? (
        <ChannelRow
          businessId={channelData.channel.businessId}
          displayName={channelData.channel.displayName}
          handle={channelData.channel.handle}
          logoUrl={channelData.channel.logoUrl}
          isFollowing={isFollowing}
          locale={locale}
        />
      ) : null}
      <TermsCard terms={terms} locale={locale} />
      {channelData !== null ? (
        <MoreFromChannel
          displayName={channelData.channel.displayName}
          campaigns={otherCampaigns}
          locale={locale}
        />
      ) : null}
    </div>
  );
}
