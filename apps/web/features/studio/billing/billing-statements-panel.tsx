import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import type { BillingStatement } from "@yourtal/contracts/billing";
import type { StatementPayout } from "@yourtal/contracts/billing/payouts";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";

/** Statements newest first, each with how its payout is going (joined by statement id). */
export function BillingStatementsPanel({
  statements,
  payouts,
  locale,
}: {
  statements: readonly BillingStatement[];
  payouts: readonly StatementPayout[];
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const payoutById = new Map(payouts.map((payout) => [payout.statementId, payout]));
  const rows = [...statements].sort((a, b) => b.periodFrom.localeCompare(a.periodFrom));

  const payoutLine = (payout: StatementPayout | undefined): string | null => {
    if (payout === undefined) return null;
    switch (payout.status) {
      case "paid":
        return t("billing.statementPaid", {
          last4: payout.bankLast4 ?? "",
          date: payout.paidAt === null ? "" : date.format(new Date(payout.paidAt)),
        });
      case "awaiting_account":
        return t("billing.statementAwaiting");
      case "failed":
        return t("billing.statementFailed");
      default:
        return t("billing.statementOnItsWay");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("billing.statementsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title={t("billing.statementsEmptyTitle")}
            description={t("billing.statementsEmptyDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((statement) => {
              const line = payoutLine(payoutById.get(statement.id));
              return (
                <li
                  key={statement.id}
                  className="flex flex-col gap-1 rounded-control border border-border-subtle p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-body-sm text-fg">
                    <span className="font-semibold">
                      {t("billing.statementPeriod", {
                        from: date.format(new Date(statement.periodFrom)),
                        to: date.format(new Date(statement.periodTo)),
                      })}
                    </span>
                    <MoneyAmount
                      amountMinor={statement.closingPayableMinor}
                      currency={statement.currency}
                      locale={locale}
                    />
                    <span className="text-fg-muted">
                      {t(`billing.statementStatus.${statement.status}`)}
                    </span>
                  </div>
                  {line === null ? null : (
                    <p className="text-body-sm font-sans text-fg-muted">{line}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
