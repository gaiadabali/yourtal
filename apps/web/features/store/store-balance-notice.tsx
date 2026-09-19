import Link from "next/link";
import type { Points } from "@yourtal/contracts/money";
import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";
import { Button } from "@yourtal/ui/button";
import { computeBalanceShortfall } from "./store-balance";

export interface StoreBalanceNoticeProps {
  priceInPoints: Points;
  availablePoints: Points;
}

/**
 * The insufficient-balance state (YT-0421 acceptance: "shows exactly how
 * much more is needed and how to earn it"). `shortfallPoints` is a plain
 * arithmetic result, not a value that passed through the ledger's Zod
 * boundary, so it is branded back to `Points` with `asDisplayPoints` —
 * exactly the documented display-only use case in
 * `@yourtal/contracts/money/format`, never the value path.
 *
 * "How to earn it" links to Earn (`/`) and Quick (`/quick`) rather than
 * computing a projected number of campaigns/days: that would require this
 * feature to depend on the earn-loop's own data shape and reward
 * distribution, which is out of scope for the store and would couple two
 * independently-owned features.
 */
export function StoreBalanceNotice({ priceInPoints, availablePoints }: StoreBalanceNoticeProps) {
  const shortfall = computeBalanceShortfall(priceInPoints, availablePoints);

  if (shortfall.isAffordable) {
    return (
      <p className="text-sm text-success">Saldo kamu cukup — {formatPoints(availablePoints)} tersedia untuk item ini.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-surface px-3 py-3">
      <p className="text-sm font-medium text-fg">
        Poin kamu belum cukup — kurang {formatPoints(asDisplayPoints(shortfall.shortfallPoints))} lagi.
      </p>
      <p className="text-xs text-fg-muted">
        Saldo saat ini {formatPoints(availablePoints)}, dibutuhkan {formatPoints(priceInPoints)}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary">
          <Link href="/">Cari campaign di Earn</Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href="/quick">Coba Quick</Link>
        </Button>
      </div>
    </div>
  );
}
