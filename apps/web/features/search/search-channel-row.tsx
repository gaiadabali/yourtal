"use client";

import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { ListRow } from "@yourtal/ui/list-row";
import type { FeedChannelResult } from "@yourtal/contracts/feed";

export interface SearchChannelRowProps {
  channel: FeedChannelResult;
}

/**
 * One channel result (11.7.b). Links to `/c/[handle]` — TASKS.md 11.5.d's
 * in-app channel page, built alongside this in the same phase (not yet
 * merged as this file is written; the route exists regardless of merge
 * order since both land in the same phase).
 *
 * `"use client"`: `@yourtal/ui/channel-avatar` calls `useState` without
 * declaring its own `"use client"` boundary, so it only renders safely
 * inside one — same reasoning `top-bar.tsx`'s own doc comment gives for
 * `PointsChip`/`Input`.
 */
export function SearchChannelRow({ channel }: SearchChannelRowProps) {
  return (
    <ListRow
      href={`/c/${channel.handle}`}
      leading={
        <ChannelAvatar
          decorative
          name={channel.displayName}
          {...(channel.logoUrl ? { src: channel.logoUrl } : {})}
          size="md"
        />
      }
      title={channel.displayName}
      subtitle={`@${channel.handle}`}
    />
  );
}
