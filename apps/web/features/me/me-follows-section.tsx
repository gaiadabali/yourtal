"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { ListRow } from "@yourtal/ui/list-row";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Button } from "@yourtal/ui/button";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import type { FollowEntry } from "./me-schemas";
import { unfollowAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeFollowsSectionProps {
  initialFollows: readonly FollowEntry[];
}

/**
 * A private ranking signal only (`follows.controller.ts`'s own doc
 * comment) — no follower count, no other viewer ever sees this list. This
 * screen can only unfollow; following happens from a channel page (6.4.d,
 * not built yet).
 */
export function MeFollowsSection({ initialFollows }: MeFollowsSectionProps) {
  const t = useTranslations("me.follows");
  const [follows, setFollows] = useState<readonly FollowEntry[]>(initialFollows);
  const { run } = useMeActionStatus();

  function handleUnfollow(businessId: string) {
    // Optimistic and never rolled back on error — a retry is just
    // following again, and the list still reflects the last known server
    // state next reload either way.
    setFollows(follows.filter((entry) => entry.businessId !== businessId));
    run(() => unfollowAction(businessId));
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      {follows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="flex flex-col gap-1">
          {follows.map((entry) => (
            <ListRow
              key={entry.businessId}
              leading={
                <ChannelAvatar
                  decorative
                  name={entry.displayName}
                  {...(entry.logoUrl ? { src: entry.logoUrl } : {})}
                />
              }
              title={entry.displayName}
              subtitle={`@${entry.handle}`}
              trailing={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleUnfollow(entry.businessId)}
                >
                  {t("unfollowCta")}
                </Button>
              }
            />
          ))}
        </div>
      )}
    </Section>
  );
}
