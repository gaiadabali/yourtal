import type { StudioRedemptionEntry } from "@yourtal/contracts/device/studio-redemptions";
import { asDisplayIdr, formatMoney } from "@yourtal/contracts/money/format";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";

export interface RedemptionsScreenProps {
  entries: readonly StudioRedemptionEntry[];
  locale: SupportedLocale;
}

/**
 * TASKS.md 8.2.g: today's and recent captures per location and device — a
 * read-only view of `store.counter_capture_log` (via `GET
 * /api/:tenantId/studio/redemptions`). No mutation lives here; void/refund
 * stay internal-only (`policies/resource_policies/redemption.yaml`'s
 * `refunds-and-voids-are-internal`), and there is no offline queue to
 * reconcile (TASKS.md 8.2.b) — every row here is a real, settled capture.
 */
export function RedemptionsScreen({ entries, locale }: RedemptionsScreenProps) {
  const t = getStudioTranslator(locale);
  const total = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
  const currency = entries[0]?.currency ?? "AUD";

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle as="h2">{t("redemptions.title")}</CardTitle>
        <p className="text-lg font-sans font-semibold tabular-nums text-fg">
          {formatMoney(asDisplayIdr(total), currency)}
        </p>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm font-sans text-fg-muted">{t("redemptions.empty")}</p>
        ) : (
          <DataTable
            caption={t("redemptions.caption")}
            rows={[...entries]}
            getRowKey={(row) => row.captureId}
            columns={[
              {
                key: "device",
                header: t("redemptions.deviceHeader"),
                cell: (row) => row.deviceLabel,
              },
              {
                key: "location",
                header: t("redemptions.locationHeader"),
                cell: (row) => row.locationName,
              },
              {
                key: "orderRef",
                header: t("redemptions.orderRefHeader"),
                cell: (row) => row.orderRef,
              },
              {
                key: "amount",
                header: t("redemptions.amountHeader"),
                cell: (row) => formatMoney(row.amountMinor, row.currency),
              },
              {
                key: "capturedAt",
                header: t("redemptions.capturedAtHeader"),
                cell: (row) =>
                  new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(row.capturedAt)),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
