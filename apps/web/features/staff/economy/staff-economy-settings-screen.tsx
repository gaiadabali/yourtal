import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Input } from "@yourtal/ui/input";
import { KeyValue } from "@yourtal/ui/key-value";
import { Notice } from "@yourtal/ui/notice";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import { Textarea } from "@yourtal/ui/textarea";
import type { EconomyProposal, SettingsScreen } from "@yourtal/contracts/staff/economy";
import { approveSettingAction, proposeSettingAction } from "./staff-economy-actions";

export interface StaffEconomySettingsScreenProps {
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  readonly region: "AU" | "ID";
  readonly settings: SettingsScreen;
  readonly canPropose: boolean;
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

function approveForm(
  proposal: EconomyProposal,
  region: "AU" | "ID",
  idempotencyKey: string,
  currentStaffId: string,
  t: (key: string) => string,
) {
  if (proposal.proposedBy === currentStaffId) {
    return (
      <Text size="body-sm" tone="muted">
        {t("economy.awaitingSecondApprover")}
      </Text>
    );
  }
  return (
    <form action={approveSettingAction}>
      <input type="hidden" name="region" value={region} />
      <input type="hidden" name="proposalId" value={proposal.id} />
      <input type="hidden" name="idempotencyKey" value={`${idempotencyKey}:${proposal.id}`} />
      <Button type="submit" size="sm">
        {t("economy.approveCta")}
      </Button>
    </form>
  );
}

/**
 * TASKS.md 9.5.d: every F12 setting is editable here, per region -- ceilings,
 * caps, streak, receipt, holdback tiers, cohort floors, Open Viewing limits,
 * and points expiry (F2: off by default, built and switchable per region).
 * `value` is `z.unknown()` (1.2.f's own contract) -- staff enters JSON, the
 * same "a config value, never a per-key union" reasoning that file states.
 */
export function StaffEconomySettingsScreen({
  t,
  region,
  settings,
  canPropose,
  currentStaffId,
  idempotencyKey,
  flash,
}: StaffEconomySettingsScreenProps) {
  const expiry = settings.current.find((s) => s.key === "points_expiry");
  const expiryEnabled =
    typeof expiry?.value === "object" &&
    expiry.value !== null &&
    "enabled" in expiry.value &&
    expiry.value.enabled === true;

  return (
    <div className="flex flex-col gap-6">
      {flash === undefined ? null : (
        <Notice tone={FLASH_TONE[flash] ?? "info"}>{t(`economy.flash.${flash}`)}</Notice>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.pointsExpiryTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValue
            items={[
              {
                key: "expiry",
                label: t("economy.pointsExpiryStatus"),
                value: expiryEnabled ? (
                  <StatusBadge status="warning">{t("economy.pointsExpiryOn")}</StatusBadge>
                ) : (
                  <StatusBadge status="success">{t("economy.pointsExpiryOff")}</StatusBadge>
                ),
              },
              {
                key: "raw",
                label: t("economy.currentValue"),
                value: expiry === undefined ? "—" : JSON.stringify(expiry.value),
              },
            ]}
          />
          <p className="mt-2 text-body-sm text-fg-muted">{t("economy.pointsExpiryHint")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.currentSettingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {settings.current.length === 0 ? (
            <EmptyState title={t("economy.settingsEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("economy.currentSettingsTitle")}
              rows={[...settings.current].sort((a, b) => a.key.localeCompare(b.key))}
              getRowKey={(row) => row.id}
              columns={[
                { key: "key", header: t("economy.settingKey"), cell: (row) => row.key },
                {
                  key: "value",
                  header: t("economy.currentValue"),
                  cell: (row) => <code className="text-body-sm">{JSON.stringify(row.value)}</code>,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("economy.pendingSettingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {settings.pending.length === 0 ? (
            <EmptyState title={t("economy.pendingSettingsEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("economy.pendingSettingsTitle")}
              rows={settings.pending}
              getRowKey={(row) => row.id}
              columns={[
                { key: "summary", header: t("economy.purchaseSummary"), cell: (row) => row.summary },
                { key: "proposedBy", header: t("economy.proposedBy"), cell: (row) => row.proposedBy },
                {
                  key: "action",
                  header: t("economy.columnActions"),
                  cell: (row) => approveForm(row, region, idempotencyKey, currentStaffId, t),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {canPropose ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("economy.proposeSettingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={proposeSettingAction} className="flex flex-col gap-3">
              <input type="hidden" name="region" value={region} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <Input
                name="key"
                label={t("economy.settingKeyLabel")}
                placeholder={t("economy.settingKeyPlaceholder")}
                required
                className="w-72"
              />
              <Textarea
                name="value"
                label={t("economy.settingValueLabel")}
                placeholder={t("economy.settingValuePlaceholder")}
                required
              />
              <Textarea name="reason" label={t("economy.optionalReasonLabel")} />
              <Button type="submit" className="w-fit">
                {t("economy.proposeSettingSubmit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
