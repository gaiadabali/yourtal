import { resolveConsoleContext } from "@/features/console/console-context";
import { ConsoleAccessDenied } from "@/features/console/console-access-denied";
import { ConsoleNoBusiness } from "@/features/console/console-no-business";
import { ConsoleShell } from "@/features/console/console-shell";
import { canViewZone } from "@/features/console/console-zone-access";
import { getReportsBundle } from "@/features/console/reports/reports-data";
import { ReportsScreen } from "@/features/console/reports/reports-screen";
import { getRegionDisplayConfig } from "@/features/region/get-region";

/**
 * `/business/reports` (YT-0443). Reports has no relationship gate of its
 * own (`console-zone-access.ts`: `relationship: null`) — every role that
 * can view it at all is checked here exactly like every other zone page;
 * which SECTIONS render inside `ReportsScreen` is then a second, finer
 * gate on the business's own advertiser/supplier relationships (docs/17
 * §2's "shows only the [zones/sections] they use").
 *
 * Server Component; the only client-adjacent piece in the whole subtree,
 * `reports-campaign-filter.tsx`, turns out not to need `"use client"`
 * either (it is links, not state) — see that file's docstring.
 */
export default async function BusinessReportsPage(props: PageProps<"/business/reports">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveConsoleContext(searchParams);

  if (!current) {
    return <ConsoleNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("reports", current.myRole, current.business.roles)
    : false;
  const selectedCampaignId =
    typeof searchParams.campaign === "string" ? searchParams.campaign : undefined;
  const businessQuery =
    current.business.id === defaultBusinessId ? "" : `?business=${current.business.id}`;
  const { currency } = await getRegionDisplayConfig();
  const bundle = allowed
    ? await getReportsBundle(current.business.id, current.business.displayName)
    : undefined;

  return (
    <ConsoleShell current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      {allowed && bundle ? (
        <ReportsScreen
          bundle={bundle}
          relationships={current.business.roles}
          selectedCampaignId={selectedCampaignId}
          businessQuery={businessQuery}
          currency={currency}
        />
      ) : (
        <ConsoleAccessDenied zoneLabel="Reports" />
      )}
    </ConsoleShell>
  );
}
