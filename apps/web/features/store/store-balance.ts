import type { Points } from "@yourtal/contracts/money";

/**
 * The insufficient-balance computation for the offer detail page (YT-0421
 * acceptance: "shows exactly how much more is needed"). Kept as a tiny,
 * pure, independently-testable function rather than inlined into the
 * component that renders it, per docs/13b-typescript-standards.md §9
 * ("test behaviour"): this is the one piece of logic worth a unit test on
 * that page, everything else is presentation.
 */
export interface BalanceShortfall {
  isAffordable: boolean;
  /** Points still needed, in whole points. Zero when `isAffordable` is true. */
  shortfallPoints: number;
}

export function computeBalanceShortfall(
  priceInPoints: Points,
  availablePoints: Points,
): BalanceShortfall {
  const shortfallPoints = Math.max(0, priceInPoints - availablePoints);
  return { isAffordable: shortfallPoints === 0, shortfallPoints };
}
