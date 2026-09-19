import { resolveConsoleContext } from "@/features/console/console-context";
import { ConsoleNoBusiness } from "@/features/console/console-no-business";
import { ConsoleShell } from "@/features/console/console-shell";
import { ConsoleZoneGrid } from "@/features/console/console-zone-grid";
import { buildConsoleNavItems } from "@/features/console/console-zone-items";
import { getVisibleZones } from "@/features/console/console-zone-access";

/**
 * `/business` (YT-0440) — the business console's overview: one card per
 * zone the signed-in person's role permits on the selected business.
 * Server Component per docs/13b-typescript-standards.md §8; the only
 * client leaves anywhere in this subtree are the business switcher and the
 * zone tabs, both inside `ConsoleShell`.
 */
export default async function BusinessConsolePage(props: PageProps<"/business">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveConsoleContext(searchParams);

  if (!current) {
    return <ConsoleNoBusiness />;
  }

  const visibleZones = current.myRole
    ? getVisibleZones(current.myRole, current.business.roles)
    : [];
  const navItems = buildConsoleNavItems(visibleZones);
  const businessQuery =
    current.business.id === defaultBusinessId ? "" : `?business=${current.business.id}`;

  return (
    <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      <ConsoleZoneGrid items={navItems} businessQuery={businessQuery} />
    </ConsoleShell>
  );
}
