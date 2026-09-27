import { PageHeader } from "@yourtal/ui/page-header";
import { getLocale } from "next-intl/server";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import {
  listListings,
  listLocations,
  listPendingDecreaseRequests,
} from "@/features/studio/inventory/inventory-data";
import { InventoryScreen } from "@/features/studio/inventory/inventory-screen";

/** `/studio/inventory` (task 7.4 / 7.8.b): listings, stock and pending settlement-decrease approvals. */
export default async function StudioInventoryPage(props: PageProps<"/studio/inventory">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("inventory", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <StudioChrome
        current={current}
        allMemberships={all}
        defaultBusinessId={defaultBusinessId}
        locale={locale}
      >
        <StudioAccessDenied zoneLabel="Inventory" locale={locale} />
      </StudioChrome>
    );
  }

  const { id: businessId, displayName, region, currency } = current.business;
  const [listings, locations, pendingDecreaseRequests] = await Promise.all([
    listListings(businessId, displayName, region, currency),
    listLocations(businessId, displayName, region, currency),
    listPendingDecreaseRequests(businessId),
  ]);

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title="Inventory" />}
    >
      <InventoryScreen
        listings={listings}
        locations={locations}
        pendingDecreaseRequests={pendingDecreaseRequests}
        locale={locale}
      />
    </StudioChrome>
  );
}
