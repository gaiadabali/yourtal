import { cn } from "@yourtal/ui/cn";
import { navItems } from "./nav-items";
import { NavLink } from "./nav-link";

const LINK_BASE =
  "flex w-full flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-sans font-medium text-fg-muted " +
  "transition-colors hover:bg-surface lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm";
const LINK_ACTIVE = "bg-surface text-primary";

/**
 * Side rail from `md` up, replacing the bottom bar (docs/17 §1.1: "tablet
 * and desktop widen the layout ... persistent side navigation. Not a
 * different product."). Fixed width (`w-20`, `lg:w-56`) so it never resizes
 * on route change. `pl-[env(safe-area-inset-left)]` clears a notch in
 * landscape orientation on the side the rail sits against.
 */
export function SideNav() {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center gap-1 border-r border-border",
        "bg-surface-raised py-6 md:flex lg:w-56 lg:items-stretch lg:px-3",
        "pl-[max(0px,env(safe-area-inset-left))]",
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
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
