import { resolveConsoleContext } from "@/features/console/console-context";
import { ConsoleAccessDenied } from "@/features/console/console-access-denied";
import { ConsoleNoBusiness } from "@/features/console/console-no-business";
import { ConsoleShell } from "@/features/console/console-shell";
import { canEditZone, canViewZone } from "@/features/console/console-zone-access";
import { CampaignBuilderScreen } from "@/features/console/campaign-builder/campaign-builder-screen";
import { listCampaignDrafts } from "@/features/console/campaign-builder/campaign-builder-data";

/**
 * `/business/campaigns` (YT-0441/YT-0442). Replaces the YT-0440 placeholder
 * with real content while keeping its access gating unchanged: this route
 * still requires the `advertiser` relationship and one of
 * owner/admin/marketer/analyst (`console-zone-access.ts`, untouched by this
 * ticket). Analyst gets the screen in read-only mode (`canEditZone`) rather
 * than a separate `ConsoleAccessDenied` — docs/17 §2.1's table lists
 * Analyst as `view` on Campaigns, not absent from it.
 *
 * Server Component: this is the one place in the zone that calls the
 * server-data-only `listCampaignDrafts` (docs/13b §8) — the single client
 * leaf below it, `CampaignBuilderScreen`, receives the resolved list as a
 * prop and owns every edit itself in `useState`, the same pattern
 * `BusinessTeamPage`/`TeamScreen` already use.
 */
export default async function BusinessCampaignsPage(props: PageProps<"/business/campaigns">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveConsoleContext(searchParams);

  if (!current) {
    return <ConsoleNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("campaigns", current.myRole, current.business.roles)
    : false;
  const canEdit = current.myRole
    ? canEditZone("campaigns", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
        <ConsoleAccessDenied zoneLabel="Campaigns" />
      </ConsoleShell>
    );
  }

  const drafts = await listCampaignDrafts(current.business.id, current.business.displayName);

  return (
    <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      <CampaignBuilderScreen
        businessId={current.business.id}
        merchantName={current.business.displayName}
        initialDrafts={drafts}
        canEdit={canEdit}
      />
    </ConsoleShell>
  );
}
