import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import { resolveConsoleContext } from "@/features/console/console-context";
import { ConsoleAccessDenied } from "@/features/console/console-access-denied";
import { ConsoleNoBusiness } from "@/features/console/console-no-business";
import { ConsoleShell } from "@/features/console/console-shell";
import { canViewZone } from "@/features/console/console-zone-access";
import { getCurrentUserId } from "@/features/console/console-data";
import { TeamScreen } from "@/features/console/team-screen";

function isTeamManagerRole(
  role: BusinessTeamRole,
): role is Extract<BusinessTeamRole, "owner" | "admin"> {
  return role === "owner" || role === "admin";
}

/**
 * `/business/team` (YT-0444). Team-zone `view` is gated to Owner and Admin
 * only, per `policies/resource_policies/team.yaml` and
 * `policies/tests/team_test.yaml` — a Marketer/Merchandiser/Finance/Analyst
 * gets `ConsoleAccessDenied`, not a read-only peek at the roster, matching
 * docs/17 §2.1's table (blank, not "view", in every non-owner/admin row of
 * the Team column). Server Component; all interactivity is `TeamScreen`,
 * the one client leaf for this whole zone.
 */
export default async function BusinessTeamPage(props: PageProps<"/business/team">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveConsoleContext(searchParams);

  if (!current) {
    return <ConsoleNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("team", current.myRole, current.business.roles)
    : false;

  return (
    <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      {allowed && current.myRole && isTeamManagerRole(current.myRole) ? (
        <TeamScreen
          businessId={current.business.id}
          businessDisplayName={current.business.displayName}
          currentUserId={getCurrentUserId()}
          initialViewerRole={current.myRole}
          initialRoster={current.roster}
        />
      ) : (
        <ConsoleAccessDenied zoneLabel="Team" />
      )}
    </ConsoleShell>
  );
}
