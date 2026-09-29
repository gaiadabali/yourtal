"use client";

import { PointsChip } from "@yourtal/ui/points-chip";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

export interface StoreBalanceChipProps {
  /** The viewer's real available points (`GET /api/wallet`, 11.6.a). */
  points: number;
  locale: SupportedLocale;
}

/**
 * The Store browse grid's own balance chip (11.6.a), beside the page
 * heading rather than only the shell's top bar — the founder demo brief
 * calls it out on this screen specifically, and a viewer scanning prices
 * against their balance should not have to look away from the grid to find
 * it.
 *
 * `"use client"`: `@yourtal/ui/points-chip` calls `useMemo` without its own
 * client boundary, so it only renders safely inside one — same reasoning as
 * `features/shell/top-bar.tsx`'s identical chip.
 */
export function StoreBalanceChip({ points, locale }: StoreBalanceChipProps) {
  const t = getStoreTranslator(locale);
  return (
    <PointsChip
      value={points}
      size="sm"
      locale={locale}
      formatLabel={(formatted) => t("store.balanceLabel", { points: formatted })}
    />
  );
}
