import { resolveStudioContext } from "@/features/studio/studio-context";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canEditZone, canViewZone } from "@/features/studio/studio-zone-access";
import { CampaignBuilderScreen } from "@/features/studio/campaign-builder/campaign-builder-screen";
import { listCampaignDrafts } from "@/features/studio/campaign-builder/campaign-builder-data";

/**
 * `/studio/campaigns`. Access gating unchanged from the old `/business`
 * route: the `advertiser` relationship and one of owner/admin/marketer/analyst
 * (`studio-zone-access.ts`). Analyst gets the screen in read-only mode
 * (`canEditZone`) rather than a separate `StudioAccessDenied`.
 *
 * Server Component: this is the one place in the zone that calls the
 * server-data-only `listCampaignDrafts`; the single client leaf below it,
 * `CampaignBuilderScreen`, receives the resolved list as a prop.
 */
export default async function StudioCampaignsPage(props: PageProps<"/studio/campaigns">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);

  if (!current) {
    return <StudioNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("campaigns", current.myRole, current.business.roles)
    : false;
  const canEdit = current.myRole
    ? canEditZone("campaigns", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <StudioChrome current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
        <StudioAccessDenied zoneLabel="Campaigns" />
      </StudioChrome>
    );
  }

  const drafts = await listCampaignDrafts(current.business.id, current.business.displayName);

  return (
    <StudioChrome current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      <CampaignBuilderScreen
        businessId={current.business.id}
        merchantName={current.business.displayName}
        initialDrafts={drafts}
        canEdit={canEdit}
        isVerified={current.business.isVerified}
      />
    </StudioChrome>
  );
}
