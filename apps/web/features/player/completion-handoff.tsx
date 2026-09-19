import Link from "next/link";
import { Button } from "@yourtal/ui/button";
import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";

export interface CompletionHandoffProps {
  campaignId: string;
  provisionalPoints: number;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: "en-AU" | "id-ID";
}

/**
 * Hands off to the checkpoint route at the end of playback. Per the route
 * contract in docs/tasks/phase-u-ui.md YT-0412: `/watch/[campaignId]/
 * checkpoint` is owned by another agent (YT-0413) — this component only
 * links to it, it builds nothing there. That route now exists in this
 * workspace, so `next.config.ts`'s `typedRoutes: true` can verify the
 * literal template string below directly, with no cast.
 */
export function CompletionHandoff({
  campaignId,
  provisionalPoints,
  locale = "id-ID",
}: CompletionHandoffProps) {
  const checkpointHref = `/watch/${campaignId}/checkpoint` as const;

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised p-6 text-center">
      <p className="text-sm font-sans text-fg-muted">
        You watched the whole video.{" "}
        {formatPoints(asDisplayPoints(Math.round(provisionalPoints)), locale)} pending — answer the
        checkpoint questions to confirm your reward.
      </p>
      <Button asChild>
        <Link href={checkpointHref}>Continue to questions</Link>
      </Button>
    </div>
  );
}
