import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PointsChip } from "@yourtal/ui/points-chip";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { PurchaseQuote } from "@yourtal/contracts/billing";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import type { BillingBalance } from "./billing-data";
import { purchasePointsAction } from "./purchase-points-action";

export interface BillingScreenProps {
  businessId: string;
  balance: BillingBalance;
  /** One real, server-computed quote per preset amount (`PRESET_POINT_AMOUNTS`) — never a client-derived price. */
  quotes: readonly PurchaseQuote[];
  canPurchase: boolean;
  /** Minted once per render (`page.tsx`) and embedded per form, so a double-click of the same button reuses one idempotency key rather than minting a fresh one per submit. */
  idempotencyKey: string;
  locale: SupportedLocale;
}

/**
 * The Billing zone (task 7.5 / 7.8.b): a real quote per preset amount, a
 * real purchase against the ledger, real balance. Unused points stay with
 * the business — there are no cash refunds (TASKS.md 7.5.b), so this screen
 * never offers one. Purchase history is each purchase's allocation: bought,
 * used by campaigns, left (journey 2).
 */
export function BillingScreen({
  businessId,
  balance,
  quotes,
  canPurchase,
  idempotencyKey,
  locale,
}: BillingScreenProps) {
  const t = getStudioTranslator(locale);
  // One allocation per purchase (FundReserve creates it), so it carries the drawdown too.
  const purchases = balance.allocations
    .filter((allocation) => allocation.funderType === "partner")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const number = new Intl.NumberFormat(locale);
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
                  <input
                    type="hidden"
                    name="idempotencyKey"
                    value={`${idempotencyKey}:${quote.points}`}
                  />
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
                  key={purchase.allocationId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-body-sm text-fg"
                >
                  <span className="font-semibold">{date.format(new Date(purchase.createdAt))}</span>
                  <span>
                    {t("billing.historyBought", { formatted: number.format(purchase.totalPoints) })}
                  </span>
                  <span className="text-fg-muted">
                    {t("billing.historyUsed", {
                      formatted: number.format(purchase.totalPoints - purchase.remainingPoints),
                    })}
                  </span>
                  <span>
                    {t("billing.historyLeft", {
                      formatted: number.format(purchase.remainingPoints),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
