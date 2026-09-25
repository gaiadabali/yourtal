import type { ReactNode } from "react";
import { cn } from "@yourtal/ui/cn";
import { BottomNav } from "./bottom-nav";
import type { SupportedLocale } from "./nav-i18n";
import { SideNav } from "./side-nav";
import { TopBar } from "./top-bar";

export interface ViewerShellProps {
  locale: SupportedLocale;
  /** The signed-in viewer's spendable points, shown in the top bar's chip. */
  availablePoints: number;
  /**
   * The viewer is dark-first (After Dark, F3) — every caller gets `"dark"`
   * until the Me screen grows a real light/dark setting. `data-theme` on the
   * root is what every token in tokens.css keys off; nothing here is bespoke
   * CSS.
   */
  theme?: "light" | "dark";
  children: ReactNode;
}

/**
 * The five-tab consumer shell (task 3.5.c, replacing what `app-shell.tsx`
 * used to render directly). Reused as-is by the gallery
 * (`app/(lab)/lab/ui/groups/shells.tsx`) and by the real app
 * (`app-shell.tsx`) — which is why it takes `locale` and `availablePoints`
 * as plain props rather than resolving the region cookie or a wallet read
 * itself. `region-context.tsx`'s doc comment spells out the underlying
 * rule: "a Client Component can hold Server Component children, it just
 * cannot import or render them itself." The gallery's `ShellsGroup` is a
 * Client Component, so it can only render this tree directly if nothing in
 * it has a server-only import — `app-shell.tsx` (a Server Component) is
 * where the region cookie actually gets read, once, and handed down.
 *
 * `data-surface="viewer"` and `data-theme` on the root are what every token
 * in `packages/ui/src/styles/tokens.css` keys off.
 *
 * Layout stability: `<main>` reserves the exact space the fixed bottom nav
 * and sticky top bar occupy (bottom pad on mobile sized to the bottom bar's
 * height plus its safe-area inset, left pad from `lg` sized to the side
 * rail) so content never renders under the chrome, and the reserved space
 * itself never changes across a route change — the shell's own contribution
 * to CLS is zero by construction.
 */
export function ViewerShell({
  locale,
  availablePoints,
  theme = "dark",
  children,
}: ViewerShellProps) {
  return (
    <div data-surface="viewer" data-theme={theme} className="min-h-dvh bg-canvas text-fg">
      <TopBar locale={locale} availablePoints={availablePoints} />
      <SideNav locale={locale} />
      <main
        className={cn(
          "min-h-dvh pb-[calc(4rem+max(0px,env(safe-area-inset-bottom)))]",
          "lg:pb-0 lg:pl-56",
        )}
      >
        {children}
      </main>
      <BottomNav locale={locale} />
    </div>
  );
}
