import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDuration } from "@/features/campaign/campaign-format";
import { FollowButton } from "@/features/player/follow-button";
import { isFollowingBusiness } from "@/features/player/follow-actions";
import { getChannelByHandle } from "@/features/player/get-channel-by-handle";
import { getPlayerTranslator } from "@/features/player/player-i18n";
import { SpendAtBrand } from "@/features/player/spend-at-brand";
import { getDisplayLocale } from "@/i18n/get-locale";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { Card, CardContent } from "@yourtal/ui/card";

interface ChannelPageProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: ChannelPageProps): Promise<Metadata> {
  const { handle } = await params;
  const found = await getChannelByHandle(handle);
  if (found === null) {
    return { title: "YourTal" };
  }
  return { title: `${found.channel.displayName} · YourTal` };
}

/**
 * `/c/[handle]` (11.5.d) — the in-app channel page: cover, logo, Follow,
 * the business's still-live campaigns and its own store listings.
 *
 * No dedicated cover image exists for a business (`business.business_accounts`
 * has no such column, and adding one is a schema change outside this
 * session's write set — TASKS.md "Areas and ownership"); the most recent
 * live campaign's own `posterUrl` stands in as the page's hero image
 * instead. That is real, already-served artwork for this exact business,
 * never a placeholder or a fabricated asset.
 */
export default async function ChannelPage({ params }: ChannelPageProps) {
  const { handle } = await params;
  const found = await getChannelByHandle(handle);
  if (found === null) {
    notFound();
  }
  const { channel, campaigns, listings } = found;
  const [locale, isFollowing] = await Promise.all([
    getDisplayLocale(),
    isFollowingBusiness(channel.businessId),
  ]);
  const t = getPlayerTranslator(locale);
  const cover = campaigns[0]?.posterUrl ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {cover !== null ? (
        <img src={cover} alt="" className="h-32 w-full rounded-lg object-cover sm:h-48" />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelAvatar
            name={channel.displayName}
            size="lg"
            {...(channel.logoUrl ? { src: channel.logoUrl } : {})}
          />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-lg font-sans font-semibold text-fg">
              {channel.displayName}
            </h1>
            <p className="truncate text-sm font-sans text-fg-muted">@{channel.handle}</p>
          </div>
        </div>
        <FollowButton
          businessId={channel.businessId}
          initialFollowing={isFollowing}
          locale={locale}
        />
      </div>

      {campaigns.length > 0 ? (
        <section className="flex flex-col gap-3">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <a href={`/watch/${campaign.id}`} className="block">
                  <Card>
                    <CardContent className="flex items-center gap-3 p-3">
                      <img
                        src={campaign.posterUrl}
                        alt=""
                        className="h-14 w-24 shrink-0 rounded-md object-cover"
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-sans font-medium text-fg">
                          {campaign.title}
                        </span>
                        <span className="text-xs font-sans text-fg-muted">
                          {formatDuration(campaign.durationSeconds, locale)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm font-sans text-fg-muted">{t("channel.noCampaigns")}</p>
      )}

      <SpendAtBrand merchantName={channel.displayName} listings={listings} locale={locale} />
    </div>
  );
}
