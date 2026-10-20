import type { AreaSummary } from "@yourtal/contracts/areas/schema";

/** "Bondi, Bondi Beach and 2 more", or the postcode alone if no suburb is known for it. */
export function areaSummaryLabel(
  summary: Pick<AreaSummary, "postcode" | "names" | "moreCount">,
  andMore: (count: number) => string,
): string {
  if (summary.names.length === 0) return summary.postcode;
  const names = summary.names.join(", ");
  return summary.moreCount > 0 ? `${names} ${andMore(summary.moreCount)}` : names;
}

/** The first letter a suburb is filed under; anything that is not A to Z goes under "#". */
export function areaLetter(name: string): string {
  const first = name.normalize("NFD").charAt(0).toLocaleUpperCase("en-AU");
  return /^[A-Z]$/.test(first) ? first : "#";
}
