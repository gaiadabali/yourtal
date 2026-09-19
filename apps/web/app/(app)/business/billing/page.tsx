import { resolveConsoleContext } from "@/features/console/console-context";
import { ConsoleAccessDenied } from "@/features/console/console-access-denied";
import { ConsoleNoBusiness } from "@/features/console/console-no-business";
import { ConsoleShell } from "@/features/console/console-shell";
import { ConsoleZonePlaceholder } from "@/features/console/console-zone-placeholder";
import { canViewZone } from "@/features/console/console-zone-access";

/** `/business/billing` — zone slot only; no ticket owns Billing's content in this phase yet. See YT-0440's report. */
export default async function BusinessBillingPage(props: PageProps<"/business/billing">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveConsoleContext(searchParams);

  if (!current) {
    return <ConsoleNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("billing", current.myRole, current.business.roles)
    : false;

  return (
    <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      {allowed ? (
        <ConsoleZonePlaceholder zoneLabel="Billing" ticketId="unscheduled" />
      ) : (
        <ConsoleAccessDenied zoneLabel="Billing" />
      )}
    </ConsoleShell>
  );
}
