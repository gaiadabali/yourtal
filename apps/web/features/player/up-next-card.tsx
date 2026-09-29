import type { Campaign } from "@yourtal/contracts/campaign";
import { Card, CardContent } from "@yourtal/ui/card";
import { Button } from "@yourtal/ui/button";
import { formatDuration } from "@/features/campaign/campaign-format";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface UpNextCardProps {
  campaign: Campaign;
  locale: SupportedLocale;
}

/**
 * 11.5.c: the completion screen's "Up next" — a plain link the viewer must
 * tap, never an autoplaying continuation into another campaign's reward
 * loop (the founder's explicit rule for this ticket). A real full
 * navigation (`<a>`, matching `campaign-entry-card.tsx`'s own reasoning for
 * its "start video" link) rather than client-side player state carrying
 * over from one campaign's session into another's.
 */
export function UpNextCard({ campaign, locale }: UpNextCardProps) {
  const t = getPlayerTranslator(locale);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-xs font-sans font-semibold uppercase tracking-wide text-fg-subtle">
          {t("upNext.heading")}
        </p>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line yt-b/prefer-primitives -- a plain poster thumbnail, not a styled control */}
          <img
            src={campaign.posterUrl}
            alt=""
            className="h-16 w-28 shrink-0 rounded-md object-cover"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-sans font-medium text-fg">
              {campaign.title}
            </span>
            <span className="text-xs font-sans text-fg-muted">
              {campaign.merchantName} · {formatDuration(campaign.durationSeconds, locale)}
            </span>
          </div>
        </div>
        <Button asChild size="sm">
          <a href={`/watch/${campaign.id}`}>{t("upNext.play")}</a>
        </Button>
      </CardContent>
    </Card>
  );
}
