import { getLocale } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { studioDataSourceMode } from "@/features/studio/studio-data-source";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canEditZone, canViewZone } from "@/features/studio/studio-zone-access";
import { CampaignBuilderScreen } from "@/features/studio/campaign-builder/campaign-builder-screen";
import { listCampaignDrafts } from "@/features/studio/campaign-builder/campaign-builder-data";
import { getBalance } from "@/features/studio/billing/billing-data";

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
  const locale = resolveSupportedLocale(await getLocale());

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("campaigns", current.myRole, current.business.roles)
    : false;
  const canEdit = current.myRole
    ? canEditZone("campaigns", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <StudioChrome
        current={current}
        allMemberships={all}
        defaultBusinessId={defaultBusinessId}
        locale={locale}
        header={<PageHeader title="Campaigns" />}
      >
        <StudioAccessDenied zoneLabel="Campaigns" locale={locale} />
      </StudioChrome>
    );
  }

  const [drafts, allocations] = await Promise.all([
    listCampaignDrafts(current.business.id, current.business.displayName),
    // `GET .../billing/balance` is gated on `billing:view` (owner/admin/
    // finance — `studio-zone-access.ts`), a narrower set than Campaigns'
    // own viewers (owner/admin/marketer/analyst). A marketer or analyst can
    // legitimately reach this page with no billing access at all, so a
    // refusal here degrades to an empty allocation list (no picker to show)
    // rather than crashing the whole zone — the real `PUT .../reward`
    // endpoint is gated on `campaign:edit`, not `billing:view`, so this is
    // only a picker-convenience gap, not a security one.
    getBalance(current.business.id)
      .then((balance) => balance.allocations)
      .catch(() => []),
  ]);

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title="Campaigns" />}
    >
      <CampaignBuilderScreen
        businessId={current.business.id}
        merchantName={current.business.displayName}
        initialDrafts={drafts}
        canEdit={canEdit}
        isVerified={current.business.isVerified}
        isLiveMode={studioDataSourceMode === "live"}
        allocations={allocations}
      />
    </StudioChrome>
  );
}
