import { Suspense } from "react";
import { listQuickCampaigns } from "@/features/quick/quick-data";
import { QuickFeedCard } from "@/features/quick/quick-feed-card";
import { QuickFeedEmptyState } from "@/features/quick/quick-feed-empty-state";
import { QuickFeedSkeleton } from "@/features/quick/quick-feed-skeleton";
import { QuickFeedViewport } from "@/features/quick/quick-feed-viewport";

/**
 * The Quick feed (YT-0414) — `/quick`.
 * docs/17-surfaces-and-roles.md §1.1: "TikTok — vertical, swipeable ...
 * 15-60s campaigns, points only. This is the habit loop." Server Component
 * per docs/13b-typescript-standards.md §8: this file carries no
 * `"use client"` — the only interactive leaf is `QuickFeedViewport` (the
 * scroll/snap container plus the screen-reader "which item am I on"
 * status), composed around plain Server-Component cards passed as
 * `children`, per §8's "composition — pass children/slots instead of data."
 *
 * "Quick" is visually dropped on mobile (kept for screen readers via
 * `sr-only`) because the bottom tab already names this screen, and every
 * pixel of vertical space matters for a feed meant to be swiped one full
 * item at a time. It reappears as a normal heading once the layout
 * degrades to a grid at `md` — the acceptance criterion "degrades to a
 * list on desktop rather than faking a phone" reads, on this screen, as
 * "look like a normal page again," heading included.
 */
export default function QuickPage() {
  return (
    <div className="flex flex-col gap-4 md:p-4">
      <h1 className="sr-only md:not-sr-only md:text-2xl md:font-semibold md:text-fg">Quick</h1>
      <Suspense fallback={<QuickFeedSkeleton />}>
        <QuickFeedList />
      </Suspense>
    </div>
  );
}

async function QuickFeedList() {
  const campaigns = await listQuickCampaigns();

  if (campaigns.length === 0) {
    return <QuickFeedEmptyState />;
  }

  return (
    <QuickFeedViewport>
      {campaigns.map((campaign, index) => (
        <QuickFeedCard key={campaign.id} campaign={campaign} position={index + 1} total={campaigns.length} />
      ))}
    </QuickFeedViewport>
  );
}
