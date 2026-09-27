import { getLocale } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import { getCampaignReport, getReportsBundle } from "@/features/studio/reports/reports-data";
import { ReportsScreen } from "@/features/studio/reports/reports-screen";

/**
 * `/studio/reports`. Reports has no relationship gate of its own
 * (`studio-zone-access.ts`: `relationship: null`) — every role that can view
 * it at all is checked here exactly like every other zone page; which
 * SECTIONS render inside `ReportsScreen` is then a second, finer gate on the
 * business's own advertiser/supplier relationships.
 *
 * Server Component; the only client-adjacent piece in the whole subtree,
 * `reports-campaign-filter.tsx`, turns out not to need `"use client"` either
 * (it is links, not state) — see that file's docstring.
 */
export default async function StudioReportsPage(props: PageProps<"/studio/reports">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("reports", current.myRole, current.business.roles)
    : false;
  const selectedCampaignId =
    typeof searchParams.campaign === "string" ? searchParams.campaign : undefined;
  const businessQuery =
    current.business.id === defaultBusinessId ? "" : `?business=${current.business.id}`;
  const bundle = allowed
    ? await getReportsBundle(current.business.id, current.business.displayName)
    : undefined;
  // Real (7.6.a) when a campaign is selected; `undefined` (no panel) when
  // "All campaigns" is selected. A network/server error degrades to `null`
  // (an honest "no report" gap) rather than failing the whole page for one
  // panel — matches `inventory-data.ts`/`billing-data.ts`'s own read paths,
  // which throw and let `error.tsx` catch it, but this one call is a
  // secondary enhancement on an otherwise-working page, not its main data.
  const campaignReport =
    allowed && selectedCampaignId
      ? await getCampaignReport(current.business.id, selectedCampaignId).catch(() => null)
      : undefined;

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title="Reports" />}
    >
      {allowed && bundle ? (
        <ReportsScreen
          bundle={bundle}
          relationships={current.business.roles}
          selectedCampaignId={selectedCampaignId}
          businessQuery={businessQuery}
          campaignReport={campaignReport}
          locale={locale}
        />
      ) : (
        <StudioAccessDenied zoneLabel="Reports" locale={locale} />
      )}
    </StudioChrome>
  );
}
