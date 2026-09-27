import { Badge } from "@yourtal/ui/badge";
import type { MerchantCopy } from "./merchant-i18n";

export interface MerchantConnectivityBannerProps {
  isOnline: boolean;
  copy: MerchantCopy;
}

/**
 * A persistent banner, not a transient toast — connectivity is exactly the
 * kind of state a busy cashier must be able to glance at mid-queue.
 * `role="status"` + `aria-live="polite"` announces a transition without a
 * screen reader interrupting whatever staff is doing.
 *
 * TASKS.md 8.2.b REWRITE: no offline queue and no "syncing" state any
 * more — this only ever says "you are offline"; `merchant-redemption-screen.tsx`
 * refuses to attempt a redemption at all while this is up (`portal.cantRedeemOfflineHeading`).
 */
export function MerchantConnectivityBanner({ isOnline, copy }: MerchantConnectivityBannerProps) {
  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-lg border border-border-strong p-3"
    >
      <Badge variant="danger">{copy.cantRedeemOfflineHeading}</Badge>
      <p className="text-sm font-sans text-fg-muted">{copy.cantRedeemOfflineBody}</p>
    </div>
  );
}
