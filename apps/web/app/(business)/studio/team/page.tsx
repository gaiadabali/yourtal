import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import { getLocale } from "next-intl/server";
import { dataSourceMode } from "@yourtal/contracts/mock-source";
import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import { getCurrentUserId } from "@/features/studio/studio-data";
import { listTeam } from "@/features/studio/team-data";
import { TeamScreen } from "@/features/studio/team-screen";

function isTeamManagerRole(
  role: BusinessTeamRole,
): role is Extract<BusinessTeamRole, "owner" | "admin"> {
  return role === "owner" || role === "admin";
}

/**
 * `/studio/team`. Team-zone `view` is gated to Owner and Admin only, per
 * `policies/resource_policies/team.yaml` and `policies/tests/team_test.yaml`
 * — a Marketer/Merchandiser/Finance/Analyst gets `StudioAccessDenied`, not a
 * read-only peek at the roster (`studio-zone-access.ts`). Server Component;
 * all interactivity is `TeamScreen`, the one client leaf for this zone.
 */
export default async function StudioTeamPage(props: PageProps<"/studio/team">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("team", current.myRole, current.business.roles)
    : false;

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title="Team" />}
    >
      {allowed && current.myRole && isTeamManagerRole(current.myRole) ? (
        <StudioTeamScreenData
          businessId={current.business.id}
          businessDisplayName={current.business.displayName}
          viewerRole={current.myRole}
          fallbackRoster={current.roster}
        />
      ) : (
        <StudioAccessDenied zoneLabel="Team" locale={locale} />
      )}
    </StudioChrome>
  );
}

interface StudioTeamScreenDataProps {
  businessId: string;
  businessDisplayName: string;
  viewerRole: Extract<BusinessTeamRole, "owner" | "admin">;
  fallbackRoster: BusinessMember[];
}

/**
 * Only fetched for a caller who can actually view Team — see
 * `team-data.ts`'s own doc comment on why this is not part of the cheap
 * `resolveStudioContext` read every zone gets.
 */
async function StudioTeamScreenData({
  businessId,
  businessDisplayName,
  viewerRole,
  fallbackRoster,
}: StudioTeamScreenDataProps) {
  const [currentUserId, roster] = await Promise.all([
    getCurrentUserId(),
    listTeam(businessId, fallbackRoster),
  ]);

  return (
    <TeamScreen
      businessId={businessId}
      businessDisplayName={businessDisplayName}
      currentUserId={currentUserId}
      initialViewerRole={viewerRole}
      initialRoster={roster}
      isLiveMode={dataSourceMode === "live"}
    />
  );
}
