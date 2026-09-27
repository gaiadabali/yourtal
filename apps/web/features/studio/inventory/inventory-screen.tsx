import type { Listing } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { EmptyState } from "@yourtal/ui/empty-state";
import { getStudioTranslator } from "../studio-i18n";
import type { SettlementDecreaseRequest } from "./inventory-data";

export interface InventoryScreenProps {
  listings: readonly Listing[];
  pendingDecreaseRequests: readonly SettlementDecreaseRequest[];
}

/**
 * The Inventory zone (task 7.8.b): listings and their stock (a read-only
 * projection of unallocated vouchers, 7.4.c), plus any settlement-decrease
 * request awaiting the second approver (7.4.b's two-person flow). Both
 * lists come from `inventory-data.ts`'s mock seam — see that file's comment
 * on the real, already-merged API this should flip to.
 */
export function InventoryScreen({ listings, pendingDecreaseRequests }: InventoryScreenProps) {
  const t = getStudioTranslator();
  return (
    <div className="flex flex-col gap-6">
      {pendingDecreaseRequests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("inventory.pendingDecreasesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pendingDecreaseRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border-subtle p-3"
              >
                <span className="text-body-sm text-fg">{request.listingTitle}</span>
                <span className="text-body-sm text-fg-muted">
                  <MoneyAmount
                    amountMinor={request.currentSettlementValueMinor}
                    currency={request.currency}
                  />{" "}
                  →{" "}
                  <MoneyAmount
                    amountMinor={request.proposedSettlementValueMinor}
                    currency={request.currency}
                  />
                </span>
                <Badge variant="warning">{t("inventory.awaitingSecondApproval")}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("inventory.listingsTitle")}</CardTitle>
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
                <li
                  key={listing.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border-subtle p-3"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-body font-sans text-fg">{listing.title}</span>
                    <span className="text-body-sm text-fg-muted">
                      {t("inventory.stock", {
                        remaining: listing.stockRemaining,
                        total: listing.stockTotal,
                        locations: listing.locations.length,
                      })}
                    </span>
                  </div>
                  <Badge variant={listing.status === "sold_out" ? "danger" : "success"}>
                    {listing.status.replace("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
