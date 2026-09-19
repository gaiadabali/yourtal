/**
 * Duration and data-cost formatting for the earn loop (YT-0410, YT-0411).
 *
 * docs/23-critique.md §1 and docs/06-longform-video-and-attention.md §2.3
 * both treat mobile data cost as a live purchase objection in Indonesia, not
 * a nicety — so the data-cost string is never optional and never rounded
 * away to nothing. Both formatters are pure so the card, the skeleton and
 * the entry card can share exactly one source of truth for the copy.
 */

const idNumberFormatter = new Intl.NumberFormat("id-ID");
const idOneDecimalFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Formats a duration in seconds as short Indonesian copy, e.g. "18 menit" or "45 detik". */
export function formatDuration(durationSeconds: number): string {
  if (durationSeconds < 60) {
    return `${idNumberFormatter.format(Math.round(durationSeconds))} detik`;
  }

  const totalMinutes = durationSeconds / 60;
  if (totalMinutes < 60) {
    return `${idNumberFormatter.format(Math.round(totalMinutes))} menit`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return minutes === 0
    ? `${idNumberFormatter.format(hours)} jam`
    : `${idNumberFormatter.format(hours)} jam ${idNumberFormatter.format(minutes)} menit`;
}

/**
 * Formats an estimated data cost in MB, e.g. "~210 MB" or "~12,3 MB". The
 * leading "~" is load-bearing copy, not decoration: docs/06 §2.3 rule 2
 * says to show data cost as an estimate ("≈120 MB"), never a false-precise
 * guarantee — actual bytes depend on the player's chosen quality.
 */
export function formatDataCost(estimatedDataMb: number): string {
  const formatted =
    estimatedDataMb < 10 ? idOneDecimalFormatter.format(estimatedDataMb) : idNumberFormatter.format(Math.round(estimatedDataMb));
  return `~${formatted} MB`;
}
