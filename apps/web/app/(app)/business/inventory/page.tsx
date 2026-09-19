import { resolveConsoleContext } from "@/features/console/console-context";
import { ConsoleAccessDenied } from "@/features/console/console-access-denied";
import { ConsoleNoBusiness } from "@/features/console/console-no-business";
import { ConsoleShell } from "@/features/console/console-shell";
import { ConsoleZonePlaceholder } from "@/features/console/console-zone-placeholder";
import { canViewZone } from "@/features/console/console-zone-access";

/** `/business/inventory` — zone slot only; content is part of the campaign/listing work (YT-0441), not this ticket. See YT-0440's report. */
export default async function BusinessInventoryPage(props: PageProps<"/business/inventory">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveConsoleContext(searchParams);

  if (!current) {
    return <ConsoleNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("inventory", current.myRole, current.business.roles)
    : false;

  return (
    <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      {allowed ? (
        <ConsoleZonePlaceholder zoneLabel="Inventory" ticketId="YT-0441" />
      ) : (
        <ConsoleAccessDenied zoneLabel="Inventory" />
      )}
    </ConsoleShell>
  );
}
