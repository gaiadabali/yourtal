import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { FollowButton } from "./follow-button";
import type { SupportedLocale } from "./player-i18n";

export interface ChannelRowProps {
  businessId: string;
  displayName: string;
  handle: string;
  logoUrl: string | null;
  isFollowing: boolean;
  locale: SupportedLocale;
}

/**
 * 11.5.a: the watch page's YouTube-style channel row — logo, name (linking
 * to the channel page, 11.5.d), Follow. `me-follows-section.tsx`'s own
 * `ChannelAvatar` reused for the same avatar shape everywhere a channel
 * appears.
 */
export function ChannelRow({
  businessId,
  displayName,
  handle,
  logoUrl,
  isFollowing,
  locale,
}: ChannelRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <a href={`/c/${handle}`} className="flex min-w-0 items-center gap-3">
        <ChannelAvatar decorative name={displayName} {...(logoUrl ? { src: logoUrl } : {})} />
        <span className="truncate text-sm font-sans font-semibold text-fg">{displayName}</span>
      </a>
      <FollowButton businessId={businessId} initialFollowing={isFollowing} locale={locale} />
    </div>
  );
}
