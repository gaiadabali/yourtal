"use client";

import { useAutoLock } from "./use-auto-lock";

export interface AutoLockWatcherProps {
  /** `lockDeviceAction` from `provisioning-actions.ts`, passed down from the Server Component `merchant-session-chrome.tsx` — Server Actions are a serializable reference type Next.js allows passing as ordinary props across the RSC boundary. */
  onIdle: () => Promise<void>;
}

/**
 * The ONE piece of client JS this ticket adds to an unlocked `/merchant`
 * session — everything else in this feature is a zero-JS Server Component
 * form (see `device-provisioning-form.tsx`'s doc comment on why that
 * matters for this route's bundle budget). Renders nothing; it exists only
 * to keep `useAutoLock`'s event listeners mounted for as long as the
 * redemption screen is.
 */
export function AutoLockWatcher({ onIdle }: AutoLockWatcherProps) {
  useAutoLock(() => {
    void onIdle();
  });
  return null;
}
