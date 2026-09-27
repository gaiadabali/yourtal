"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { ListRow } from "@yourtal/ui/list-row";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Button } from "@yourtal/ui/button";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import type { FollowCandidate } from "./onboarding-data";
import { followBusinessAction, unfollowBusinessAction } from "./onboarding-actions";
import { useMeActionStatus } from "@/features/me/use-me-action-status";
import { withReturnTo } from "./onboarding-return-to";

export interface OnboardingFollowStepProps {
  candidates: readonly FollowCandidate[];
  returnTo: string | null;
}

/**
 * "Follow 3 channels" (6.2.b) — real businesses in the caller's own region
 * (`GET /api/me/follows/candidates`, a region-scoped stopgap read; the
 * ranked discovery feed is Phase 11), each a real `PUT`/`DELETE
 * /api/me/follows/:businessId` round trip on tap. Never blocking: like the
 * old interest picker, zero selections still continues (a follow can
 * always be made later from a channel page, once one exists).
 */
export function OnboardingFollowStep({ candidates, returnTo }: OnboardingFollowStepProps) {
  const t = useTranslations("onboarding.follow");
  const router = useRouter();
  const [followingIds, setFollowingIds] = useState<ReadonlySet<string>>(new Set());
  const { run } = useMeActionStatus();

  function toggle(businessId: string) {
    const isFollowing = followingIds.has(businessId);
    setFollowingIds((current) => {
      const next = new Set(current);
      if (isFollowing) {
        next.delete(businessId);
      } else {
        next.add(businessId);
      }
      return next;
    });
    run(() => (isFollowing ? unfollowBusinessAction(businessId) : followBusinessAction(businessId)));
  }

  function handleContinue() {
    router.push(withReturnTo("/onboarding/done", returnTo) as Route);
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      {candidates.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="flex flex-col gap-1">
          {candidates.map((candidate) => {
            const isFollowing = followingIds.has(candidate.id);
            return (
              <ListRow
                key={candidate.id}
                leading={
                  <ChannelAvatar
                    name={candidate.displayName}
                    {...(candidate.logoUrl ? { src: candidate.logoUrl } : {})}
                  />
                }
                title={candidate.displayName}
                subtitle={`@${candidate.handle}`}
                trailing={
                  <Button
                    type="button"
                    variant={isFollowing ? "secondary" : "primary"}
                    size="sm"
                    onClick={() => toggle(candidate.id)}
                  >
                    {isFollowing ? t("followingCta") : t("followCta")}
                  </Button>
                }
              />
            );
          })}
        </div>
      )}
      <Button type="button" onClick={handleContinue}>
        {followingIds.size > 0 ? t("continueCta") : t("skipCta")}
      </Button>
    </Section>
  );
}
