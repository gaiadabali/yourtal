import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Notice } from "@yourtal/ui/notice";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import { Textarea } from "@yourtal/ui/textarea";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";
import type { KillSwitch } from "@yourtal/contracts/voucher-internal/kill-switch";
import {
  approveMarketingFundingAction,
  proposeMarketingFundingAction,
  tripKillSwitchAction,
} from "./staff-economy-actions";

export interface StaffEconomyMarketingScreenProps {
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  readonly region: "AU" | "ID";
  readonly fundings: readonly EconomyProposal[];
  readonly killSwitches: readonly KillSwitch[];
  readonly canFund: boolean;
  readonly canTripKillSwitch: boolean;
  readonly currentStaffId: string;
  readonly idempotencyKey: string;
  readonly flash: string | undefined;
}

const FLASH_TONE: Record<string, "success" | "danger" | "warning"> = {
  proposed: "success",
  approved: "success",
  killSwitch: "success",
  error: "danger",
  invalid: "warning",
};

/** TASKS.md 9.5.c: marketing funding (two-person) and kill switches (ops, single action). */
export function StaffEconomyMarketingScreen({
  t,
  region,
  fundings,
  killSwitches,
  canFund,
  canTripKillSwitch,
  currentStaffId,
  idempotencyKey,
  flash,
}: StaffEconomyMarketingScreenProps) {
  return (
    <div className="flex flex-col gap-6">
      {flash === undefined ? null : (
        <Notice tone={FLASH_TONE[flash] ?? "info"}>{t(`economy.flash.${flash}`)}</Notice>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.marketingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {fundings.length === 0 ? (
            <EmptyState title={t("economy.marketingEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("economy.marketingTitle")}
              rows={[...fundings]}
              getRowKey={(row) => row.id}
              columns={[
                { key: "summary", header: t("economy.purchaseSummary"), cell: (row) => row.summary },
                {
                  key: "status",
                  header: t("economy.columnStatus"),
                  cell: (row) => t(`economy.status.${row.status}`),
                },
                {
                  key: "action",
                  header: t("economy.columnActions"),
                  cell: (row) =>
                    row.status !== "pending" ? null : row.proposedBy === currentStaffId ? (
                      <Text size="body-sm" tone="muted">
                        {t("economy.awaitingSecondApprover")}
                      </Text>
                    ) : (
                      <form action={approveMarketingFundingAction}>
                        <input type="hidden" name="region" value={region} />
                        <input type="hidden" name="proposalId" value={row.id} />
                        <input type="hidden" name="idempotencyKey" value={`${idempotencyKey}:${row.id}`} />
                        <Button type="submit" size="sm">
                          {t("economy.approveCta")}
                        </Button>
                      </form>
                    ),
                },
              ]}
            />
          )}
          {canFund ? (
            <form action={proposeMarketingFundingAction} className="flex flex-col gap-3">
              <input type="hidden" name="region" value={region} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <Input
                type="number"
                name="amountMinor"
                label={t("economy.fundAmountLabel")}
                min={1}
                required
                className="w-64"
              />
              <Textarea name="reason" label={t("economy.reasonLabel")} required />
              <Button type="submit" className="w-fit">
                {t("economy.fundMarketingSubmit")}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.killSwitchesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {killSwitches.length === 0 ? (
            <EmptyState title={t("economy.killSwitchesEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("economy.killSwitchesTitle")}
              rows={[...killSwitches]}
              getRowKey={(row) => row.killSwitchId}
              columns={[
                { key: "scope", header: t("economy.killSwitchScope"), cell: (row) => row.scope },
                {
                  key: "target",
                  header: t("economy.killSwitchTarget"),
                  cell: (row) => row.targetId ?? t("economy.killSwitchGlobal"),
                },
                {
                  key: "active",
                  header: t("economy.columnStatus"),
                  cell: (row) =>
                    row.active ? (
                      <StatusBadge status="danger">{t("economy.killSwitchActive")}</StatusBadge>
                    ) : (
                      <StatusBadge status="success">{t("economy.killSwitchCleared")}</StatusBadge>
                    ),
                },
              ]}
            />
          )}
          {canTripKillSwitch ? (
            <form action={tripKillSwitchAction} className="flex flex-col gap-3">
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <NativeSelect name="scope" label={t("economy.killSwitchScope")} className="w-48" required>
                <option value="merchant">{t("economy.killSwitchScopeMerchant")}</option>
                <option value="listing">{t("economy.killSwitchScopeListing")}</option>
                <option value="batch">{t("economy.killSwitchScopeBatch")}</option>
                <option value="global">{t("economy.killSwitchScopeGlobal")}</option>
              </NativeSelect>
              <Input name="targetId" label={t("economy.killSwitchTargetLabel")} className="w-64" />
              <Textarea name="reason" label={t("economy.reasonLabel")} required />
              <NativeSelect name="active" label={t("economy.killSwitchStateLabel")} className="w-40" required>
                <option value="true">{t("economy.killSwitchStateTrip")}</option>
                <option value="false">{t("economy.killSwitchStateClear")}</option>
              </NativeSelect>
              <Button type="submit" variant="danger" className="w-fit">
                {t("economy.killSwitchSubmit")}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
