import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PointsChip } from "@yourtal/ui/points-chip";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { PurchaseQuote } from "@yourtal/contracts/billing";
import { getStudioTranslator } from "../studio-i18n";
import type { BillingBalance, PurchaseHistoryEntry } from "./billing-data";
import { purchasePointsAction } from "./purchase-points-action";

export interface BillingScreenProps {
  businessId: string;
  balance: BillingBalance;
  /** One real, server-computed quote per preset amount (`PRESET_POINT_AMOUNTS`) — never a client-derived price. */
  quotes: readonly PurchaseQuote[];
  purchases: readonly PurchaseHistoryEntry[];
  canPurchase: boolean;
  /** Minted once per render (`page.tsx`) and embedded per form, so a double-click of the same button reuses one idempotency key rather than minting a fresh one per submit. */
  idempotencyKey: string;
}

/**
 * The Billing zone (task 7.5 / 7.8.b): a real quote per preset amount, a
 * real purchase against the ledger, real balance. Unused points stay with
 * the business — there are no cash refunds (TASKS.md 7.5.b), so this screen
 * never offers one. Purchase history/statements need 10.1 and are 10.6.b
 * (F40) — not this screen's job yet.
 */
export function BillingScreen({
  businessId,
  balance,
  quotes,
  purchases,
  canPurchase,
  idempotencyKey,
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
            value={balance.remainingPoints}
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
          {quotes.map((quote) => (
            <div
              key={quote.points}
              className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border-subtle p-3"
            >
              <div className="flex flex-col gap-1">
                <PointsChip
                  value={quote.points}
                  formatLabel={(formatted) => t("billing.points", { formatted })}
                />
                <MoneyAmount amountMinor={quote.totalMinor} currency={quote.currency} />
              </div>
              {canPurchase ? (
                <form action={purchasePointsAction}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="points" value={quote.points} />
                  <input type="hidden" name="currency" value={quote.currency} />
                  <input type="hidden" name="idempotencyKey" value={`${idempotencyKey}:${quote.points}`} />
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
                  <MoneyAmount amountMinor={purchase.paidMinor} currency={purchase.currency} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
