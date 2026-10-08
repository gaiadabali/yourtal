import { PageHeader } from "@yourtal/ui/page-header";
import { getLocale } from "next-intl/server";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { getStudioTranslator, resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { getCurrentUserId } from "@/features/studio/studio-data";
import { canEditZone, canViewZone } from "@/features/studio/studio-zone-access";
import { canApproveSettlementDecrease } from "@/features/studio/inventory/inventory-access";
import {
  listListings,
  listLocations,
  listPendingDecreaseRequests,
  listVoucherRequests,
} from "@/features/studio/inventory/inventory-data";
import { InventoryScreen } from "@/features/studio/inventory/inventory-screen";

/** `/studio/inventory` (task 7.4 / 7.8.b, 13.3.m): outlets, listings, S changes and the second approver. */
export default async function StudioInventoryPage(props: PageProps<"/studio/inventory">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());
  const t = getStudioTranslator(locale);

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
        <StudioAccessDenied zoneLabel={t("zones.inventory")} locale={locale} />
      </StudioChrome>
    );
  }

  const { id: businessId, displayName, region, currency } = current.business;
  const role = current.myRole ?? "analyst";
  const canEdit = canEditZone("inventory", role, current.business.roles);
  const [listings, locations, pendingDecreaseRequests, voucherRequests, currentUserId] =
    await Promise.all([
      listListings(businessId, displayName, region, currency),
      listLocations(businessId, displayName, region, currency),
      listPendingDecreaseRequests(businessId),
      // Only the roles that can ask for vouchers may read the requests (analysts cannot).
      canEdit ? listVoucherRequests(businessId) : Promise.resolve([]),
      getCurrentUserId(),
    ]);

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title={getStudioTranslator(locale)("inventory.title")} />}
    >
      <InventoryScreen
        businessId={businessId}
        merchantName={displayName}
        region={region}
        currency={currency}
        canEdit={canEdit}
        canApprove={canApproveSettlementDecrease(role)}
        currentUserId={currentUserId}
        listings={listings}
        locations={locations}
        pendingDecreaseRequests={pendingDecreaseRequests}
        voucherRequests={voucherRequests}
        locale={locale}
      />
    </StudioChrome>
  );
}
