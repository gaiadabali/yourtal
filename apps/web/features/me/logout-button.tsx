"use client";

import { Button } from "@yourtal/ui/button";
import { logoutAction } from "@/lib/api/actions";
import { clearSessionScopedServiceWorkerCache } from "@/features/shell/clear-session-cache";

export interface LogoutButtonProps {
  label: string;
}

/**
 * 6.9.b: the one client leaf `/me`'s log-out control needs. `onSubmit`
 * fires before the form's Server Action (`logoutAction`) runs — it does
 * not intercept or delay the submission, only adds the "forget this
 * session's cached pages" side effect `clear-session-cache.ts` describes.
 */
export function LogoutButton({ label }: LogoutButtonProps) {
  return (
    <form action={logoutAction} onSubmit={() => clearSessionScopedServiceWorkerCache()}>
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}
