import type { Campaign } from "@yourtal/contracts/campaign";
import { Card, CardContent } from "@yourtal/ui/card";
import { formatDuration } from "@/features/campaign/campaign-format";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface MoreFromChannelProps {
  displayName: string;
  campaigns: readonly Campaign[];
  locale: SupportedLocale;
}

/**
 * 11.5.a: "more from this channel" — every other still-live campaign from
 * this business (`get-watch-channel.ts` already excludes nothing; the
 * current campaign is filtered out by the caller, `page.tsx`, since only it
 * knows which one that is). Plain link cards, same "no autoplay, a real tap
 * required" discipline the completion screen's Up Next card follows —
 * these are entry points into ANOTHER watch page, not inline playback.
 */
export function MoreFromChannel({ displayName, campaigns, locale }: MoreFromChannelProps) {
  const t = getPlayerTranslator(locale);
  if (campaigns.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-sans font-semibold text-fg">
        {t("channel.moreFromChannel", { name: displayName })}
      </h2>
      <ul className="flex list-none flex-col gap-2 p-0">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <a href={`/watch/${campaign.id}`} className="block">
              <Card>
                <CardContent className="flex items-center gap-3 p-3">
                  <img
                    src={campaign.posterUrl}
                    alt=""
                    className="h-14 w-24 shrink-0 rounded-md object-cover"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-sans font-medium text-fg">
                      {campaign.title}
                    </span>
                    <span className="text-xs font-sans text-fg-muted">
                      {formatDuration(campaign.durationSeconds, locale)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
