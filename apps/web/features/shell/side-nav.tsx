import { cn } from "@yourtal/ui/cn";
import { getNavTranslator, type SupportedLocale } from "./nav-i18n";
import { navItems } from "./nav-items";
import { NavLink } from "./nav-link";

export interface SideNavProps {
  locale: SupportedLocale;
}

const LINK_BASE =
  "flex w-full items-center gap-3 rounded-control px-3 py-2 text-label font-sans font-medium " +
  "text-fg-muted transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-sunken";
const LINK_ACTIVE = "bg-surface-sunken text-accent";

/**
 * Side rail from `lg` (1024px) up, replacing the bottom bar — task 3.5.c
 * moved this from `md`, so the rail is a desktop affordance only; a tablet
 * in portrait keeps the mobile bottom nav (docs/17 §1.1 talks about
 * "tablet and desktop" together, but 1024px is where this app actually has
 * room for a persistent 56-character-wide label column without cramping
 * page content). Fixed width (`w-56`) so it never resizes on route change.
 * `pl-[env(safe-area-inset-left)]` clears a notch in landscape orientation
 * on the side the rail sits against.
 *
 * Takes `locale` as a plain prop — see `bottom-nav.tsx`'s doc comment for
 * why (same reasoning, same catalogue, so the two chrome variants can never
 * disagree on a label for a given region).
 */
export function SideNav({ locale }: SideNavProps) {
  const t = getNavTranslator(locale);

  return (
    <nav
      aria-label={t("primary")}
      className={cn(
        "fixed inset-y-0 left-0 z-(--z-nav) hidden w-56 flex-col gap-1 border-r border-border-subtle",
        "bg-surface px-3 py-6 lg:flex",
        "pl-[max(0.75rem,env(safe-area-inset-left))]",
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
            <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
