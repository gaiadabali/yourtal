import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";

export interface CompletionHandoffProps {
  campaignId: string;
  provisionalPoints: number;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: "en-AU" | "id-ID";
}

/**
 * Used to hand off to `/watch/[campaignId]/checkpoint`. 5.2.e deleted that
 * route along with the mock, client-scored quiz behind it
 * (`checkpoint-quiz.tsx`, `checkpoint-data.ts`) — it leaked the answer key
 * to the browser and was never wired to a real session, which this whole
 * mock player has none of. The real hand-off belongs to Phase 6's player
 * rebuild (TASKS.md 6.4.b/c), against real checkpoint sessions
 * (`POST /api/watch/sessions/:id/checkpoints/:index`) rather than a
 * `campaignId`-keyed mock route. Until then this only reports the
 * provisional figure; it links nowhere rather than to a 404.
 */
export function CompletionHandoff({ provisionalPoints, locale = "id-ID" }: CompletionHandoffProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised p-6 text-center">
      <p className="text-sm font-sans text-fg-muted">
        You watched the whole video.{" "}
        {formatPoints(asDisplayPoints(Math.round(provisionalPoints)), locale)} pending — answer the
        checkpoint questions to confirm your reward.
      </p>
    </div>
  );
}
