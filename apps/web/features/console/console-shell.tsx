import type { ReactNode } from "react";
import type { BusinessMembership } from "./console-data";
import { ConsoleHeader } from "./console-header";
import { buildConsoleNavItems } from "./console-zone-items";
import { getVisibleZones } from "./console-zone-access";

export interface ConsoleShellProps {
  current: BusinessMembership;
  allMemberships: readonly BusinessMembership[];
  defaultBusinessId: string;
  children: ReactNode;
}

/**
 * The business console shell (YT-0440): desktop-first, capped at a
 * comfortable reading/working width rather than stretching full-bleed on a
 * wide monitor, and usable down to tablet width with no horizontal scroll
 * (`min-w-0` throughout the content column; nothing here sets a fixed px
 * width wider than the container).
 *
 * This renders INSIDE `app/(app)/layout.tsx`'s shared `<main>` (the
 * consumer five-tab shell — see this ticket's report for why that nesting
 * exists and its consequence: the consumer's own bottom/side nav still
 * renders around this console, because `app/(app)/layout.tsx` is shared
 * and out of this ticket's scope). Server Component end to end — the only
 * client leaves are inside `ConsoleHeader`.
 */
export function ConsoleShell({
  current,
  allMemberships,
  defaultBusinessId,
  children,
}: ConsoleShellProps) {
  const businessQuery =
    current.business.id === defaultBusinessId ? "" : `?business=${current.business.id}`;
  const visibleZones = current.myRole
    ? getVisibleZones(current.myRole, current.business.roles)
    : [];
  const navItems = buildConsoleNavItems(visibleZones);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 p-4 md:p-6">
      <ConsoleHeader
        current={current}
        allMemberships={allMemberships}
        defaultBusinessId={defaultBusinessId}
        navItems={navItems}
        businessQuery={businessQuery}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
