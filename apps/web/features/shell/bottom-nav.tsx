import { cn } from "@yourtal/ui/cn";
import { getRegionDisplayConfig } from "@/features/region/get-region";
import { getNavTranslator } from "./nav-i18n";
import { navItems } from "./nav-items";
import { NavLink } from "./nav-link";

const LINK_BASE =
  "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-sans font-medium text-fg-muted transition-colors";
const LINK_ACTIVE = "text-primary";

/**
 * Bottom tab bar, mobile only (`md:hidden`). Fixed height (`h-16`) plus a
 * safe-area-aware bottom pad so the bar clears the home indicator on
 * notched devices without hardcoding a device-specific pixel value — see
 * docs/13b-typescript-standards.md and the ticket's safe-area requirement.
 * The height never changes across renders or routes, which is what keeps
 * route transitions from shifting the shell chrome (CLS gate, docs/08 §3.1).
 *
 * `async` (YT-0058): the five tab labels now come from `nav.json` via the
 * request's actual region, not a hardcoded English string. `getRegion*`
 * is server-only (reads the region cookie through `next/headers`), which
 * is exactly why this stays a plain Server Component rather than gaining
 * `"use client"` — see nav-link.tsx for the one client leaf this tree has.
 */
export async function BottomNav() {
  const { locale } = await getRegionDisplayConfig();
  const t = getNavTranslator(locale);

  return (
    <nav
      aria-label={t("primary")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-border bg-surface-raised md:hidden",
        "pb-[max(0px,env(safe-area-inset-bottom))]",
      )}
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.href}
            href={item.href}
            matchPrefixes={item.matchPrefixes}
            className={LINK_BASE}
            activeClassName={LINK_ACTIVE}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
