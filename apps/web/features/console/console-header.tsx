import { Badge } from "@yourtal/ui/badge";
import type { BusinessMembership } from "./console-data";
import { ConsoleBusinessSwitcher } from "./console-business-switcher";
import { ConsoleZoneNav } from "./console-zone-nav";
import type { ConsoleNavItem } from "./console-zone-items";
import { ROLE_LABELS } from "./console-roles";

export interface ConsoleHeaderProps {
  current: BusinessMembership;
  /** Every business the signed-in person holds a role at, for the switcher — omitted entirely (not just hidden) when there is only one. */
  allMemberships: readonly BusinessMembership[];
  defaultBusinessId: string;
  navItems: readonly ConsoleNavItem[];
  businessQuery: string;
}

/**
 * The business console's chrome above its zone content: business identity,
 * the switcher (only when there is a choice to make), and the zone tabs.
 * Server Component — the only client leaves underneath are
 * `ConsoleBusinessSwitcher` and `ConsoleZoneNav`.
 */
export function ConsoleHeader({
  current,
  allMemberships,
  defaultBusinessId,
  navItems,
  businessQuery,
}: ConsoleHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-border-strong pb-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-fg">{current.business.displayName}</h1>
            {current.business.isVerified ? <Badge variant="success">Verified</Badge> : null}
          </div>
          <p className="text-sm font-sans text-fg-muted">
            {current.business.district} · You are{" "}
            {current.myRole ? ROLE_LABELS[current.myRole] : "an unassigned member"}
          </p>
        </div>
        {allMemberships.length > 1 ? (
          <ConsoleBusinessSwitcher
            currentBusinessId={current.business.id}
            defaultBusinessId={defaultBusinessId}
            options={allMemberships.map((membership) => ({
              id: membership.business.id,
              displayName: membership.business.displayName,
              myRole: membership.myRole ? ROLE_LABELS[membership.myRole] : "no role",
            }))}
          />
        ) : null}
      </div>
      <ConsoleZoneNav items={navItems} businessQuery={businessQuery} />
    </header>
  );
}
