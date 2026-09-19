import { resolveConsoleContext } from "@/features/console/console-context";
import { ConsoleAccessDenied } from "@/features/console/console-access-denied";
import { ConsoleNoBusiness } from "@/features/console/console-no-business";
import { ConsoleShell } from "@/features/console/console-shell";
import { ConsoleZonePlaceholder } from "@/features/console/console-zone-placeholder";
import { canViewZone } from "@/features/console/console-zone-access";

/** `/business/redemption` — zone slot only; the real redemption surface is the merchant portal (YT-0445/0446), a different app. See YT-0440's report. */
export default async function BusinessRedemptionPage(props: PageProps<"/business/redemption">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveConsoleContext(searchParams);

  if (!current) {
    return <ConsoleNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("redemption", current.myRole, current.business.roles)
    : false;

  return (
    <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      {allowed ? (
        <ConsoleZonePlaceholder zoneLabel="Redemption" ticketId="YT-0445 / YT-0446" />
      ) : (
        <ConsoleAccessDenied zoneLabel="Redemption" />
      )}
    </ConsoleShell>
  );
}
