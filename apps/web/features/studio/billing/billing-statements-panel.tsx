import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import type { BillingStatement } from "@yourtal/contracts/billing";
import type { StatementPayout } from "@yourtal/contracts/billing/payouts";
import type { Region } from "@yourtal/contracts/region";
import { REGION_TIME_ZONE } from "@/features/region/region-time-zone";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";

const STATEMENT_BADGE = { open: "secondary", disputed: "warning", paid: "success" } as const;

/** What the statement is made of, from the figures it already carries, so a row is never a bare status. */
function StatementDetails({
  statement,
  locale,
  region,
}: {
  statement: BillingStatement;
  locale: SupportedLocale;
  region: Region;
}) {
  const t = getStudioTranslator(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: REGION_TIME_ZONE[region],
  });
  const money = (amountMinor: number) => (
    <MoneyAmount amountMinor={amountMinor} currency={statement.currency} locale={locale} />
  );
  return (
    <details className="text-body-sm font-sans text-fg-muted">
      <summary className="cursor-pointer text-fg">{t("billing.statementDetails")}</summary>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt>{t("billing.statementOpening")}</dt>
        <dd className="text-right text-fg">{money(statement.openingPayableMinor)}</dd>
        <dt>{t("billing.statementCaptures")}</dt>
        <dd className="text-right text-fg">{money(statement.capturesMinor)}</dd>
        <dt>{t("billing.statementRefunds")}</dt>
        <dd className="text-right text-fg">{money(statement.refundsMinor)}</dd>
        <dt>{t("billing.statementRecoveries")}</dt>
        <dd className="text-right text-fg">{money(statement.recoveriesMinor)}</dd>
        <dt className="font-semibold text-fg">{t("billing.statementClosing")}</dt>
        <dd className="text-right font-semibold text-fg">{money(statement.closingPayableMinor)}</dd>
      </dl>
      <p className="mt-2">
        {t(`billing.statementStatusHelp.${statement.status}`, {
          date: when.format(new Date(statement.disputeWindowEndsAt)),
        })}
      </p>
      {statement.status === "disputed" && statement.disputeReason !== null ? (
        <p className="mt-1">
          {t("billing.statementDisputeReason", { reason: statement.disputeReason })}
        </p>
      ) : null}
    </details>
  );
}

/** Statements newest first, each with how its payout is going (joined by statement id). */
export function BillingStatementsPanel({
  statements,
  payouts,
  locale,
  region,
}: {
  statements: readonly BillingStatement[];
  payouts: readonly StatementPayout[];
  locale: SupportedLocale;
  region: Region;
}) {
  const t = getStudioTranslator(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: REGION_TIME_ZONE[region],
  });
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
                    <Badge variant={STATEMENT_BADGE[statement.status]}>
                      {t(`billing.statementStatus.${statement.status}`)}
                    </Badge>
                  </div>
                  {line === null ? null : (
                    <p className="text-body-sm font-sans text-fg-muted">{line}</p>
                  )}
                  <StatementDetails statement={statement} locale={locale} region={region} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
