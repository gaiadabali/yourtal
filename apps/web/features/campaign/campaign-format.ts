/**
 * Duration and data-cost formatting for the earn loop (YT-0410, YT-0411).
 *
 * docs/23-critique.md §1 and docs/06-longform-video-and-attention.md §2.3
 * both treat mobile data cost as a live purchase objection in Indonesia, not
 * a nicety — so the data-cost string is never optional and never rounded
 * away to nothing. Both formatters are pure so the card, the skeleton and
 * the entry card can share exactly one source of truth for the copy.
 *
 * YT-0405: both take an optional `locale`, defaulting to `id-ID` so every
 * existing call site keeps rendering exactly what it renders today. A
 * screen that has resolved the active region (`apps/web/features/region`)
 * passes its `locale` through; nothing here decides the region itself.
 */

type SupportedLocale = "en-AU" | "id-ID";

const NUMBER_FORMATTERS: Record<SupportedLocale, Intl.NumberFormat> = {
  "en-AU": new Intl.NumberFormat("en-AU"),
  "id-ID": new Intl.NumberFormat("id-ID"),
};

const ONE_DECIMAL_FORMATTERS: Record<SupportedLocale, Intl.NumberFormat> = {
  "en-AU": new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  "id-ID": new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
};

interface DurationWords {
  readonly seconds: string;
  readonly minutes: string;
  readonly hours: string;
}

const DURATION_WORDS: Record<SupportedLocale, DurationWords> = {
  "en-AU": { seconds: "sec", minutes: "min", hours: "hr" },
  "id-ID": { seconds: "detik", minutes: "menit", hours: "jam" },
};

/** Formats a duration in seconds as short copy, e.g. "18 menit" or "18 min". */
/**
 * YT-0405: `locale` is REQUIRED on both formatters, not defaulted.
 *
 * They previously defaulted to `"id-ID"`. Every production call site passed
 * it explicitly, so nothing rendered Indonesian to an AU user — the leak was
 * latent, not live. It is still worth removing: in an AU-primary product a
 * shared formatter that silently falls back to Indonesian fails in the
 * wrong direction, and a default turns "someone forgot the argument" into a
 * wrong-language render instead of a compile error. Found by `yourtal-ca`
 * during the Phase U review sweep.
 */
export function formatDuration(durationSeconds: number, locale: SupportedLocale): string {
  const words = DURATION_WORDS[locale];
  const numberFormatter = NUMBER_FORMATTERS[locale];

  if (durationSeconds < 60) {
    return `${numberFormatter.format(Math.round(durationSeconds))} ${words.seconds}`;
  }

  const totalMinutes = durationSeconds / 60;
  if (totalMinutes < 60) {
    return `${numberFormatter.format(Math.round(totalMinutes))} ${words.minutes}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return minutes === 0
    ? `${numberFormatter.format(hours)} ${words.hours}`
    : `${numberFormatter.format(hours)} ${words.hours} ${numberFormatter.format(minutes)} ${words.minutes}`;
}

/**
 * Formats an estimated data cost in MB, e.g. "~210 MB" or "~12,3 MB". The
 * leading "~" is load-bearing copy, not decoration: docs/06 §2.3 rule 2
 * says to show data cost as an estimate ("≈120 MB"), never a false-precise
 * guarantee — actual bytes depend on the player's chosen quality. "MB" is
 * not translated: it reads identically in both locales.
 */
export function formatDataCost(estimatedDataMb: number, locale: SupportedLocale): string {
  const formatted =
    estimatedDataMb < 10
      ? ONE_DECIMAL_FORMATTERS[locale].format(estimatedDataMb)
      : NUMBER_FORMATTERS[locale].format(Math.round(estimatedDataMb));
  return `~${formatted} MB`;
}
