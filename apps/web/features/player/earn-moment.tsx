import { PointsChip } from "@yourtal/ui/points-chip";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

/** Plain `Intl`, not next-intl's `useFormatter` — this feature keeps zero next-intl calls (6.1.d). */
function formatUnlockDate(locale: SupportedLocale, iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

export interface EarnMomentProps {
  points: number;
  unlockAt: string | null;
  locale: SupportedLocale;
}

/**
 * The real earn moment (11.5.b), replacing `CompletionHandoff`'s provisional
 * "pending" copy for this route: by the time this renders, the server has
 * already judged the session complete and the ledger has already granted —
 * `pendingPoints`/`unlockAt` come straight from `POST .../complete`'s
 * response, not from a client tally.
 */
export function EarnMoment({ points, unlockAt, locale }: EarnMomentProps) {
  const t = getPlayerTranslator(locale);

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised p-6 text-center"
    >
      <PointsChip
        value={points}
        prefix="+"
        size="lg"
        locale={locale}
        aria-label={t("earn.earnedAriaLabel", { points })}
      />
      {unlockAt ? (
        <p className="text-sm font-sans text-fg-muted">
          {t("earn.unlocks", { date: formatUnlockDate(locale, unlockAt) })}
        </p>
      ) : null}
    </div>
  );
}

export interface NotEarningMomentProps {
  reason: string | null;
  locale: SupportedLocale;
}

/** Shown when the session completed but nothing was granted (already earned, an unfunded campaign, or a ledger refusal). */
export function NotEarningMoment({ reason, locale }: NotEarningMomentProps) {
  const t = getPlayerTranslator(locale);
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface-raised p-6 text-center"
    >
      <p className="text-sm font-sans text-fg-muted">{reason ?? t("earn.notEarningGeneric")}</p>
    </div>
  );
}
