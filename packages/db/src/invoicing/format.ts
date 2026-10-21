/** Invoice wording is en-AU: only AU issues invoices while Indonesia is a demo (F104). */
const POINTS = new Intl.NumberFormat("en-AU");
const DAY = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function pointsLine(points: number): string {
  return `${POINTS.format(points)} YourTal points`;
}

const POINTS_ID = new Intl.NumberFormat("id-ID");

/** 2.10.b (F127): a receipt package, bought at cost to pay a partner's receipt rewards. */
export function receiptPointsLine(points: number, region: "AU" | "ID" = "AU"): string {
  return region === "ID"
    ? `${POINTS_ID.format(points)} poin YourTal untuk hadiah struk`
    : `${POINTS.format(points)} YourTal points for receipt rewards`;
}

/** `2026-10-03` as "3 Oct 2026"; the string is a calendar date, so no time zone moves it. */
export function calendarDay(isoDate: string): string {
  return DAY.format(new Date(`${isoDate}T00:00:00Z`));
}

export function boostLine(title: string, firstDay: string, lastDay: string): string {
  const days =
    firstDay === lastDay
      ? `on ${calendarDay(firstDay)}`
      : `from ${calendarDay(firstDay)} to ${calendarDay(lastDay)}`;
  return `Boost for the campaign "${title}", ${days}`;
}
