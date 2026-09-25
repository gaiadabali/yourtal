import { cn } from "@yourtal/ui/cn";
import { getNavTranslator, type SupportedLocale } from "./nav-i18n";
import { navItems } from "./nav-items";
import { NavLink } from "./nav-link";

export interface BottomNavProps {
  locale: SupportedLocale;
}

const LINK_BASE =
  "flex flex-1 flex-col items-center justify-center gap-0.5 text-caption font-sans font-medium " +
  "text-fg-muted transition-colors duration-(--duration-fast) ease-standard";
const LINK_ACTIVE = "text-accent";

/**
 * Bottom tab bar, below `lg` only (task 3.5.c widened this from `md`, so a
 * tablet in portrait still gets the mobile chrome — the side rail is a
 * desktop-width affordance now, not a tablet one). Fixed height (`h-16`)
 * plus a safe-area-aware bottom pad so the bar clears the home indicator on
 * notched devices without hardcoding a device-specific pixel value — see
 * docs/13b-typescript-standards.md and the ticket's safe-area requirement.
 * The height never changes across renders or routes, which is what keeps
 * route transitions from shifting the shell chrome (CLS gate, docs/08 §3.1).
 *
 * Takes `locale` as a plain prop rather than resolving the region cookie
 * itself (YT-0058's original design) — see `viewer-shell.tsx`'s doc comment:
 * this is what lets the exact same component render from the real app's
 * Server Component tree (`app-shell.tsx`) or from the gallery's Client
 * Component tree, with no server-only import to make that a one-way door.
 */
export function BottomNav({ locale }: BottomNavProps) {
  const t = getNavTranslator(locale);

  return (
    <nav
      aria-label={t("primary")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-(--z-nav) flex h-16 border-t border-border-subtle bg-surface lg:hidden",
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
