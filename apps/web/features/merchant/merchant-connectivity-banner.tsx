import { Badge } from "@yourtal/ui/badge";
import type { MerchantCopy } from "./merchant-copy";

export interface MerchantConnectivityBannerProps {
  isOnline: boolean;
  isSyncing: boolean;
  copy: MerchantCopy;
}

/**
 * A persistent banner, not a transient toast — connectivity is exactly the
 * kind of state a busy cashier must be able to glance at mid-queue, not
 * catch in a three-second window before it disappears (this ticket's
 * "poor connectivity... not a desk" brief). `role="status"` +
 * `aria-live="polite"` announces a transition without a screen reader
 * interrupting whatever staff is doing.
 */
export function MerchantConnectivityBanner({
  isOnline,
  isSyncing,
  copy,
}: MerchantConnectivityBannerProps) {
  if (isOnline && !isSyncing) {
    return null;
  }

  const label = !isOnline ? copy.offlineLabel : copy.syncingLabel;
  const variant = !isOnline ? "danger" : "warning";
  const message = !isOnline ? copy.offlineBanner : copy.backOnlineBanner;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-lg border border-border-strong p-3"
    >
      <Badge variant={variant}>{label}</Badge>
      <p className="text-sm font-sans text-fg-muted">{message}</p>
    </div>
  );
}
