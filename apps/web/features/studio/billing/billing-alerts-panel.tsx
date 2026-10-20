import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { BudgetAlert } from "@yourtal/contracts/billing";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";

export interface BillingAlertsPanelProps {
  /** Newest first, as the API returns them. */
  alerts: readonly BudgetAlert[];
  locale: SupportedLocale;
}

/**
 * 14.13.b: the in-app half of the budget alerts (the owner and finance members
 * are emailed too). Studio has no notifications surface, so they list here.
 * At 100% rewards have stopped, so that row says so and reads as a warning.
 */
export function BillingAlertsPanel({ alerts, locale }: BillingAlertsPanelProps) {
  const t = getStudioTranslator(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const number = new Intl.NumberFormat(locale);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("billing.alertsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <EmptyState
            title={t("billing.alertsEmptyTitle")}
            description={t("billing.alertsEmptyDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {alerts.map((alert) => {
              const stopped = alert.thresholdPct === 100;
              const values = {
                pct: alert.thresholdPct,
                formatted: number.format(alert.totalPoints),
                title: alert.campaignTitle ?? t("billing.alertCampaignUntitled"),
              };
              const key = `billing.alert${alert.kind === "package" ? "Package" : "Campaign"}${stopped ? "Stopped" : ""}`;
              return (
                <li
                  key={alert.id}
                  className="flex flex-col gap-1 rounded-control border border-border-subtle p-3"
                >
                  <p
                    className={
                      stopped
                        ? "text-body-sm font-semibold text-danger"
                        : "text-body-sm font-semibold text-fg"
                    }
                  >
                    {t(key, values)}
                  </p>
                  <p className="text-body-sm text-fg-muted">
                    {t("billing.alertUsage", {
                      used: number.format(alert.usedPoints),
                      total: number.format(alert.totalPoints),
                    })}
                    {" · "}
                    <time dateTime={alert.createdAt}>{date.format(new Date(alert.createdAt))}</time>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
