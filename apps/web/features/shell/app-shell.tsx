import type { ReactNode } from "react";
import { mixedStateBalanceFixture } from "@yourtal/contracts/balance/mock";
import { RumReporterLoader } from "@/features/rum/rum-reporter-loader";
import { getRegionDisplayConfig } from "@/features/region/get-region";
import { ViewerShell } from "./viewer-shell";

export interface AppShellProps {
  children: ReactNode;
}

/**
 * The real `(app)` route tree's shell (YT-0402). Deliberately stays a
 * Server Component (see `rum-reporter-loader.tsx`'s doc comment on why the
 * RUM mount needs that) so it can resolve the region cookie once and hand a
 * plain `locale` down to `ViewerShell` (task 3.5.c) — which itself has no
 * server-only import, precisely so the gallery can render the same
 * component tree from a Client Component (see `viewer-shell.tsx`'s doc
 * comment).
 *
 * `availablePoints`: no shell-safe wallet read exists yet —
 * `features/wallet/wallet-data.ts` is scoped to `app/(app)/wallet/**` by its
 * own doc comment, and importing it here would cross that boundary. Standing
 * in with the same mixed-state balance fixture the Wallet screen itself
 * reads from (`@yourtal/contracts/balance/mock`) until a real, shell-wide
 * balance read is threaded through (tracked for a later phase).
 */
export async function AppShell({ children }: AppShellProps) {
  const { locale } = await getRegionDisplayConfig();
  return (
    <>
      <RumReporterLoader />
      <ViewerShell locale={locale} availablePoints={mixedStateBalanceFixture.availablePoints}>
        {children}
      </ViewerShell>
    </>
  );
}
