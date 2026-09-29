"use client";

import { useState, useTransition } from "react";
import { Button } from "@yourtal/ui/button";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";
import { followAction, unfollowAction } from "./follow-button-actions";

export interface FollowButtonProps {
  businessId: string;
  initialFollowing: boolean;
  locale: SupportedLocale;
}

/**
 * 11.5.a/11.5.d: the channel row's and channel page's Follow control.
 * Optimistic (flips immediately, same "cheap to undo" reasoning
 * `not-interested` actions elsewhere in this app already follow) but rolls
 * back on a failed request rather than trusting the optimistic state —
 * `PUT`/`DELETE /api/me/follows/:businessId` are themselves idempotent
 * (`@NotValueMoving`), so a retry-safe click is exactly what the server
 * side already promises.
 */
export function FollowButton({ businessId, initialFollowing, locale }: FollowButtonProps) {
  const t = getPlayerTranslator(locale);
  const [following, setFollowing] = useState(initialFollowing);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = !following;
    setFollowing(next);
    startTransition(async () => {
      const result = next ? await followAction(businessId) : await unfollowAction(businessId);
      if (!result.ok) {
        setFollowing(!next);
        return;
      }
      setFollowing(result.data.following);
    });
  };

  return (
    <Button
      type="button"
      variant={following ? "secondary" : "default"}
      size="sm"
      disabled={isPending}
      aria-pressed={following}
      onClick={toggle}
    >
      {following ? t("channel.following") : t("channel.follow")}
    </Button>
  );
}
