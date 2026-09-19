import type { ReactNode } from "react";
import { cn } from "@yourtal/ui/cn";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";

export interface AppShellProps {
  children: ReactNode;
}

/**
 * The app shell (YT-0402). A Server Component end to end — see nav-link.tsx
 * for the one client leaf this tree contains.
 *
 * Layout stability: `<main>` reserves the exact space the fixed nav
 * occupies (bottom pad on mobile sized to the bottom bar's height plus its
 * safe-area inset, left pad from `md` sized to the side rail) so content
 * never renders under the chrome and the reserved space itself never
 * changes across a route change — the shell's own contribution to CLS is
 * zero by construction.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-bg">
      <SideNav />
      <main
        className={cn(
          "min-h-dvh pb-[calc(4rem+max(0px,env(safe-area-inset-bottom)))]",
          "md:pb-0 md:pl-20 lg:pl-56",
        )}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
