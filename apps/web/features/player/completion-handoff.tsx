import { asDisplayPoints, formatPointsIn } from "@yourtal/contracts/money/format";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface CompletionHandoffProps {
  campaignId: string;
  provisionalPoints: number;
  /** No default (6.1.c) — a caller that forgets this must fail to compile, not silently render the wrong region's language. */
  locale: SupportedLocale;
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
export function CompletionHandoff({ provisionalPoints, locale }: CompletionHandoffProps) {
  const t = getPlayerTranslator(locale);
  const points = formatPointsIn(locale, asDisplayPoints(Math.round(provisionalPoints)));
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised p-6 text-center">
      <p className="text-sm font-sans text-fg-muted">
        {t("completion.watchedPending", { points })}
      </p>
    </div>
  );
}
