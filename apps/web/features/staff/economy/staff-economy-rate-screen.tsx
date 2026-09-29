import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Input } from "@yourtal/ui/input";
import { KeyValue } from "@yourtal/ui/key-value";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { Textarea } from "@yourtal/ui/textarea";
import type { RateScreen } from "@yourtal/contracts/staff/economy";
import { approveRateAction, proposeRateAction } from "./staff-economy-actions";

export interface StaffEconomyRateScreenProps {
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  readonly region: "AU" | "ID";
  readonly rate: RateScreen | null;
  readonly currentStaffId: string;
  readonly idempotencyKey: string;
  readonly flash: string | undefined;
}

const FLASH_TONE: Record<string, "success" | "danger" | "warning"> = {
  proposed: "success",
  approved: "success",
  error: "danger",
  invalid: "warning",
};

/**
 * TASKS.md 9.5.b: finance-only. B never leaves this screen -- 9.5's other
 * pages never fetch `rateScreenSchema` at all, and `no-backing-rate-in-api
 * .test.ts` (F54) is the build-time guarantee that stays true even if a
 * future edit here tried to leak it elsewhere.
 */
export function StaffEconomyRateScreen({
  t,
  region,
  rate,
  currentStaffId,
  idempotencyKey,
  flash,
}: StaffEconomyRateScreenProps) {
  if (rate === null) {
    return (
      <EmptyState
        title={t("economy.rateNotAvailableTitle")}
        description={t("economy.rateNotAvailableBody")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {flash === undefined ? null : (
        <Notice tone={FLASH_TONE[flash] ?? "info"}>{t(`economy.flash.${flash}`)}</Notice>
      )}

      <Notice tone="warning" title={t("economy.rateSecrecyTitle")}>
        {t("economy.rateSecrecyBody")}
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.currentRateTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValue
            items={[
              {
                key: "rate",
                label: t("economy.currentRateLabel"),
                value:
                  rate.currentBackingRateMicrosPerPoint === null
                    ? t("economy.currentRateUnavailable")
                    : t("economy.currentRateValue", {
                        micros: rate.currentBackingRateMicrosPerPoint,
                        currency: rate.currency,
                      }),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.pendingRateTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rate.pending.length === 0 ? (
            <EmptyState title={t("economy.pendingRateEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("economy.pendingRateTitle")}
              rows={rate.pending}
              getRowKey={(row) => row.id}
              columns={[
                {
                  key: "summary",
                  header: t("economy.purchaseSummary"),
                  cell: (row) => row.summary,
                },
                {
                  key: "proposedBy",
                  header: t("economy.proposedBy"),
                  cell: (row) => row.proposedBy,
                },
                {
                  key: "action",
                  header: t("economy.columnActions"),
                  cell: (row) =>
                    row.proposedBy === currentStaffId ? (
                      <Text size="body-sm" tone="muted">
                        {t("economy.awaitingSecondApprover")}
                      </Text>
                    ) : (
                      <form action={approveRateAction}>
                        <input type="hidden" name="region" value={region} />
                        <input type="hidden" name="proposalId" value={row.id} />
                        <input
                          type="hidden"
                          name="idempotencyKey"
                          value={`${idempotencyKey}:${row.id}`}
                        />
                        <Button type="submit" size="sm">
                          {t("economy.approveCta")}
                        </Button>
                      </form>
                    ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.proposeRateTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={proposeRateAction} className="flex flex-col gap-3">
            <input type="hidden" name="region" value={region} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <Input
              type="number"
              name="backingRateMicrosPerPoint"
              label={t("economy.newRateLabel")}
              min={1}
              required
              className="w-64"
            />
            <Textarea name="reason" label={t("economy.optionalReasonLabel")} />
            <Button type="submit" className="w-fit">
              {t("economy.proposeRateSubmit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
