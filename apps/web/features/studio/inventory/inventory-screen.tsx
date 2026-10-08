import type { Listing } from "@yourtal/contracts/listing";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { AddLocationDialog } from "./add-location-dialog";
import type { SettlementDecreaseRequest, VoucherBatchRequest } from "./inventory-data";
import { InventoryListingRow } from "./inventory-listing-row";
import type { Currency } from "./listing-form";
import { ListingFormDialog } from "./listing-form-dialog";
import { PendingDecreasesCard } from "./pending-decreases-card";

export interface InventoryScreenProps {
  businessId: string;
  merchantName: string;
  region: "AU" | "ID";
  currency: Currency;
  listings: readonly Listing[];
  locations: readonly MerchantLocation[];
  pendingDecreaseRequests: readonly SettlementDecreaseRequest[];
  /** Every voucher batch request the business has made, newest first; `null` if they could not be loaded. */
  voucherRequests: readonly VoucherBatchRequest[] | null;
  /** Owner, admin or merchandiser. Cosmetic: the API enforces every write. */
  canEdit: boolean;
  /** Owner or admin: the only roles the policy lets approve a cut to S. */
  canApprove: boolean;
  currentUserId: string;
  locale: SupportedLocale;
}

/**
 * The Inventory zone (docs/17 section 2): outlets, listings with the price the
 * platform computed, changes to S and the second approver's queue. Buttons are
 * hidden for roles that cannot use them, which is never the security boundary.
 */
export function InventoryScreen({
  businessId,
  merchantName,
  region,
  currency,
  listings,
  locations,
  pendingDecreaseRequests,
  voucherRequests,
  canEdit,
  canApprove,
  currentUserId,
  locale,
}: InventoryScreenProps) {
  const t = getStudioTranslator(locale);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">{t("inventory.locationsTitle")}</CardTitle>
          {canEdit ? <AddLocationDialog businessId={businessId} /> : null}
        </CardHeader>
        <CardContent>
          {locations.length === 0 ? (
            <EmptyState
              title={t("inventory.locationsEmptyTitle")}
              description={t("inventory.locationsEmptyDescription")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {locations.map((location) => (
                <li key={location.id} className="text-body-sm text-fg">
                  <span className="font-sans font-medium">{location.name}</span>{" "}
                  <span className="text-fg-muted">
                    — {location.address}, {location.district}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PendingDecreasesCard
        businessId={businessId}
        requests={pendingDecreaseRequests}
        listings={listings}
        canApprove={canApprove}
        currentUserId={currentUserId}
        locale={locale}
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle as="h2">{t("inventory.listingsTitle")}</CardTitle>
          {canEdit ? (
            <ListingFormDialog
              businessId={businessId}
              merchantName={merchantName}
              region={region}
              currency={currency}
              locations={locations}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          {listings.length === 0 ? (
            <EmptyState
              title={t("inventory.emptyTitle")}
              description={t("inventory.emptyDescription")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {listings.map((listing) => (
                <InventoryListingRow
                  key={listing.id}
                  businessId={businessId}
                  listing={listing}
                  canEdit={canEdit}
                  requests={
                    voucherRequests === null
                      ? null
                      : voucherRequests.filter((request) => request.listingId === listing.id)
                  }
                  locale={locale}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
