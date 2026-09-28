import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import type { Region } from "@yourtal/contracts/region";
import type { Currency } from "@yourtal/contracts/money/currency";
import { getLocale } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { studioDataSourceMode } from "@/features/studio/studio-data-source";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import { getCurrentUserId } from "@/features/studio/studio-data";
import { listTeam } from "@/features/studio/team-data";
import { TeamScreen } from "@/features/studio/team-screen";
import { listDevicesLive } from "@/features/studio/devices-data";
import { listLocations } from "@/features/studio/inventory/inventory-data";
import { TeamDevicesPanel } from "@/features/studio/team-devices-panel";

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
        <div className="flex flex-col gap-6">
          <StudioTeamScreenData
            businessId={current.business.id}
            businessDisplayName={current.business.displayName}
            viewerRole={current.myRole}
            fallbackRoster={current.roster}
          />
          <StudioTeamDevicesData
            businessId={current.business.id}
            merchantName={current.business.displayName}
            region={current.business.region}
            currency={current.business.currency}
          />
        </div>
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
      isLiveMode={studioDataSourceMode === "live"}
    />
  );
}

interface StudioTeamDevicesDataProps {
  businessId: string;
  merchantName: string;
  region: Region;
  currency: Currency;
}

/**
 * TASKS.md 8.1.a's UI half: a real round trip to
 * `apps/api/src/modules/devices/studio-devices.controller.ts`, unlike
 * `TeamScreen`'s own mock/live split above — this endpoint has no mock
 * mode at all (it was built live from the start, TASKS.md 8.2's server
 * merge). A device list failure degrades to an empty panel rather than
 * failing the whole page — Team itself already rendered successfully.
 */
async function StudioTeamDevicesData({
  businessId,
  merchantName,
  region,
  currency,
}: StudioTeamDevicesDataProps) {
  const [devicesResult, locations] = await Promise.all([
    listDevicesLive(businessId),
    listLocations(businessId, merchantName, region, currency),
  ]);
  return (
    <TeamDevicesPanel
      businessId={businessId}
      initialDevices={devicesResult.ok ? devicesResult.data : []}
      locations={locations}
    />
  );
}
