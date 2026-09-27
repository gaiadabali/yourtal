import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import {
  listListings,
  listPendingDecreaseRequests,
} from "@/features/studio/inventory/inventory-data";
import { InventoryScreen } from "@/features/studio/inventory/inventory-screen";

/** `/studio/inventory` (task 7.4 / 7.8.b): listings, stock and pending settlement-decrease approvals. */
export default async function StudioInventoryPage(props: PageProps<"/studio/inventory">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);

  if (!current) {
    return <StudioNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("inventory", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <StudioChrome current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
        <StudioAccessDenied zoneLabel="Inventory" />
      </StudioChrome>
    );
  }

  const { id: businessId, displayName, region, currency } = current.business;
  const [listings, pendingDecreaseRequests] = await Promise.all([
    listListings(businessId, displayName, region, currency),
    listPendingDecreaseRequests(businessId),
  ]);

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      header={<PageHeader title="Inventory" />}
    >
      <InventoryScreen listings={listings} pendingDecreaseRequests={pendingDecreaseRequests} />
    </StudioChrome>
  );
}
