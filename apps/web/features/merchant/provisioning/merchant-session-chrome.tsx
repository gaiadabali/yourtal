import type { ReactNode } from "react";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import type { MerchantDevice } from "../merchant-device";
import { getProvisioningCopy } from "./provisioning-copy";
import { lockDeviceAction } from "./provisioning-actions";
import { AutoLockWatcher } from "./auto-lock-watcher";

export interface MerchantSessionChromeProps {
  device: MerchantDevice;
  children: ReactNode;
}

/**
 * Wraps the unlocked redemption screen (`page.tsx`) with: a manual "Lock
 * now" control (zero-JS `<form action={lockDeviceAction}>`, for a staff
 * member who is stepping away and knows it, rather than waiting on the
 * inactivity timer) and `AutoLockWatcher`, the one client leaf that
 * enforces the same lock automatically. Composition (`children`), not a
 * data prop — docs/13b-typescript-standards.md section 8's no-prop-
 * drilling rule #1 — so this stays a Server Component even though its one
 * child leaf is a Client Component.
 */
export function MerchantSessionChrome({ device, children }: MerchantSessionChromeProps) {
  const copy = getProvisioningCopy(device.locale);
  return (
    <div className="flex flex-col">
      <div className="mx-auto flex w-full max-w-xl items-center justify-between px-4 pt-3">
        <Badge variant="secondary">{device.label}</Badge>
        <form action={lockDeviceAction}>
          <Button type="submit" variant="outline" size="sm">
            {copy.lockButton}
          </Button>
        </form>
      </div>
      {children}
      <AutoLockWatcher onIdle={lockDeviceAction} />
    </div>
  );
}
