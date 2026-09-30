import type { ReactNode } from "react";
import { getWalletBalance } from "@/features/wallet/wallet-data";
import { getNotifications } from "@/features/notifications/notifications-data";
import { RumReporterLoader } from "@/features/rum/rum-reporter-loader";
import { getDisplayLocale } from "@/i18n/get-locale";
import { getMeProfile } from "@/features/me/me-data";
import { z } from "zod";
import { apiFetch } from "@/lib/api/api-fetch";
import { readThemeCookie } from "@/lib/api/session-cookies";

const streakResponseSchema = z.object({ currentLength: z.number().int().min(0) });
import { ViewerShell } from "./viewer-shell";

export interface AppShellProps {
  children: ReactNode;
}

/**
 * The real `(app)` route tree's shell (YT-0402). Deliberately stays a
 * Server Component (see `rum-reporter-loader.tsx`'s doc comment on why the
 * RUM mount needs that) so it can resolve the display locale (`yt_locale`,
 * 6.1.b — independent of region) once and hand it down to `ViewerShell`
 * (task 3.5.c) — which itself has no
 * server-only import, precisely so the gallery can render the same
 * component tree from a Client Component (see `viewer-shell.tsx`'s doc
 * comment).
 *
 * `availablePoints` is the viewer's real spendable balance; if the wallet
 * read fails the chip shows 0 rather than a made-up number. 11.7.a's
 * notifications read is the same "fail soft" shape: an empty bell rather
 * than a broken shell if `GET /api/me/notifications` errors.
 */
export async function AppShell({ children }: AppShellProps) {
  const [locale, wallet, notifications, me, theme, streak] = await Promise.all([
    getDisplayLocale(),
    getWalletBalance(),
    getNotifications(),
    getMeProfile(),
    readThemeCookie(),
    apiFetch("/api/me/streak", streakResponseSchema),
  ]);
  // 13.13.d: the streak is a header badge; 12.2.b: teens get no streak anywhere.
  const streakDays =
    streak.ok && me.ok && me.data.profile.ageBand !== "teen" ? streak.data.currentLength : 0;
  // 13.18.b: a failed profile read drops the avatar menu, never the shell.
  const account = me.ok
    ? {
        displayName: me.data.profile.displayName,
        email: me.data.email ?? null,
        hasStudio: me.data.businessMemberships.length > 0,
        hasStaff: me.data.staffRoles.length > 0,
      }
    : undefined;
  return (
    <>
      <RumReporterLoader />
      <ViewerShell
        locale={locale}
        availablePoints={wallet.ok ? wallet.data.availablePoints : 0}
        notifications={notifications.ok ? notifications.data.notifications : []}
        theme={theme}
        streakDays={streakDays}
        {...(account ? { account } : {})}
      >
        {children}
      </ViewerShell>
    </>
  );
}
