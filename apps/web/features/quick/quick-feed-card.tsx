import type { Campaign } from "@yourtal/contracts/campaign";
import { formatPoints } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { cn } from "@yourtal/ui/cn";
import { formatDataCost, formatDuration } from "@/features/campaign/campaign-format";
import { buildQuickFeedItemLabel } from "./quick-feed-label";
import { QUICK_FEED_ITEM_SHAPE_CLASS } from "./quick-feed-layout";

export interface QuickFeedCardProps {
  campaign: Campaign;
  /** 1-based position in the feed, for the screen-reader "Video N dari M" status. */
  position: number;
  total: number;
}

/**
 * One item in the Quick feed (YT-0414) — docs/17-surfaces-and-roles.md
 * §1.1's "TikTok — vertical, swipeable" surface, <=60s campaigns, points
 * only. Every fact the long-form entry card treats as non-negotiable
 * (docs/06-longform-video-and-attention.md §3, "the entry card is a
 * contract") — duration, estimated data cost, reward — is stated here too,
 * in plain text, before the only action.
 *
 * DELIBERATELY NOT A VIDEO PLAYER: there is no `<video>` element, no
 * hls.js, nothing that can play on its own anywhere in this component.
 * Reaching the actual player is a real navigation to `/watch/[campaignId]`
 * (the existing long-form player, YT-0412 — it is kind-agnostic and
 * already renders any campaign by duration/reward, quick or long-form
 * alike), which itself still requires its own explicit tap-to-play
 * overlay before anything plays. That is this ticket's enforcement of
 * "never autoplays into an item the user did not navigate to" — see
 * `quick-feed-viewport.tsx` and this ticket's report for the full
 * reasoning.
 *
 * The title is the only link, with a stretched hit target (`::after`) over
 * the whole card — the same pattern `campaign-card.tsx` uses on the earn
 * board: one clear accessible name, not a card-sized link swallowing every
 * word. A plain `<a>`, not `next/link`: this points straight at the heavy
 * player route (which dynamically imports hls.js on intent), and
 * `next/link`'s default prefetch would fetch that route's JS the moment
 * every visible card entered the viewport — exactly the unwanted data
 * spend docs/08-web-app-and-performance.md's data-cost budget exists to
 * prevent. See `campaign-entry-card.tsx` for the identical reasoning
 * applied to its own "Mulai video" action.
 */
export function QuickFeedCard({ campaign, position, total }: QuickFeedCardProps) {
  const watchHref = `/watch/${campaign.id}`;
  const rewardLabel =
    campaign.scoringRule === "base_plus_accuracy_bonus"
      ? `Hingga ${formatPoints(campaign.rewardPoints)}`
      : formatPoints(campaign.rewardPoints);
  const itemLabel = buildQuickFeedItemLabel({
    merchantName: campaign.merchantName,
    title: campaign.title,
    position,
    total,
  });

  return (
    <li
      data-quick-feed-item
      data-quick-feed-label={itemLabel}
      className={cn(
        "relative flex shrink-0 snap-start snap-always flex-col justify-between gap-4 border-b border-border bg-surface-raised p-6",
        "md:shrink md:snap-align-none md:rounded-xl md:border md:p-5 md:shadow-sm",
        QUICK_FEED_ITEM_SHAPE_CLASS,
      )}
    >
      <header className="flex flex-col gap-1">
        <p className="truncate text-xs font-medium text-fg-subtle" title={campaign.merchantName}>
          {campaign.merchantName}
        </p>
        <h2 className="line-clamp-2 text-xl font-semibold leading-snug text-fg md:text-lg">
          <a
            href={watchHref}
            className="static rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {campaign.title}
          </a>
        </h2>
      </header>

      <p className="line-clamp-3 text-sm text-fg-muted md:line-clamp-4">{campaign.synopsis}</p>

      <footer className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <span>{formatDuration(campaign.durationSeconds)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDataCost(campaign.estimatedDataMb)}</span>
        </div>
        <Badge variant="reward" className="w-fit text-sm">
          {rewardLabel}
        </Badge>
      </footer>
    </li>
  );
}
