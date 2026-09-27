import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PointsChip } from "@yourtal/ui/points-chip";
import { EmptyState } from "@yourtal/ui/empty-state";
import { getStudioTranslator } from "../studio-i18n";
import type { BillingBalance, PointsPack, PurchaseRecord } from "./billing-data";
import { purchasePackAction } from "./purchase-pack-action";

export interface BillingScreenProps {
  businessId: string;
  balance: BillingBalance;
  packs: readonly PointsPack[];
  purchases: readonly PurchaseRecord[];
  canPurchase: boolean;
}

/**
 * The Billing zone (task 7.8.b): pack prices, a simulated purchase, balance
 * and purchase history. Unused points stay with the business — there are
 * no cash refunds (TASKS.md 7.5.b), so this screen never offers one.
 */
export function BillingScreen({
  businessId,
  balance,
  packs,
  purchases,
  canPurchase,
}: BillingScreenProps) {
  const t = getStudioTranslator();
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("billing.balanceTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PointsChip
            value={balance.availablePoints}
            size="lg"
            formatLabel={(formatted) => t("billing.pointsAvailable", { formatted })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("billing.buyPointsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border-subtle p-3"
            >
              <div className="flex flex-col gap-1">
                <PointsChip
                  value={pack.points}
                  formatLabel={(formatted) => t("billing.points", { formatted })}
                />
                <MoneyAmount amountMinor={pack.priceMinor} currency={pack.currency} />
              </div>
              {canPurchase ? (
                <form action={purchasePackAction}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="packId" value={pack.id} />
                  <input type="hidden" name="currency" value={pack.currency} />
                  <Button type="submit">{t("billing.buy")}</Button>
                </form>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("billing.purchaseHistoryTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {purchases.length === 0 ? (
            <EmptyState
              title={t("billing.emptyTitle")}
              description={t("billing.emptyDescription")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {purchases.map((purchase) => (
                <li
                  key={purchase.id}
                  className="flex items-center justify-between gap-3 text-body-sm text-fg"
                >
                  <span>{new Date(purchase.purchasedAt).toLocaleDateString()}</span>
                  <PointsChip
                    value={purchase.points}
                    size="sm"
                    formatLabel={(formatted) => t("billing.points", { formatted })}
                  />
                  <MoneyAmount amountMinor={purchase.priceMinor} currency={purchase.currency} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
