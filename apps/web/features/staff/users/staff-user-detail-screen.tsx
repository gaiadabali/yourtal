import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Input } from "@yourtal/ui/input";
import { KeyValue } from "@yourtal/ui/key-value";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Notice } from "@yourtal/ui/notice";
import { PointsChip } from "@yourtal/ui/points-chip";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Textarea } from "@yourtal/ui/textarea";
import type { StaffRole } from "@yourtal/contracts/staff/session";
import type { StaffUserDetail, StaffUserLedgerHistory } from "@yourtal/contracts/staff/users";
import {
  goodwillAction,
  releaseUserAction,
  setTrustTierAction,
  suspendUserAction,
} from "./staff-user-actions";

export interface StaffUserDetailScreenProps {
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  readonly session: { readonly roles: readonly StaffRole[] };
  readonly user: StaffUserDetail;
  readonly ledger: StaffUserLedgerHistory;
  /** Minted once per render, embedded in every form (a double-click replays, not double-acts). */
  readonly idempotencyKey: string;
  /** One of suspended/released/goodwill/trust_tier/error/invalid, from `?flag=1`. */
  readonly flash: string | undefined;
}

const FLASH_TONE: Record<string, "success" | "danger" | "warning"> = {
  suspended: "success",
  released: "success",
  goodwill: "success",
  trust_tier: "success",
  error: "danger",
  invalid: "warning",
};

/** TASKS.md 9.4.a-d: one account's profile, ledger, and every staff action on it. */
export function StaffUserDetailScreen({
  t,
  session,
  user,
  ledger,
  idempotencyKey,
  flash,
}: StaffUserDetailScreenProps) {
  const canSuspend = session.roles.includes("risk_analyst");
  const canGoodwill = session.roles.includes("support");
  const hiddenFields = (
    <>
      <input type="hidden" name="userId" value={user.userId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {flash === undefined ? null : (
        <Notice tone={FLASH_TONE[flash] ?? "info"}>{t(`users.flash.${flash}`)}</Notice>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("users.profileTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <KeyValue
            items={[
              { key: "email", label: t("users.columnEmail"), value: user.email ?? "—" },
              { key: "userId", label: t("users.userIdLabel"), value: user.userId },
              { key: "region", label: t("users.columnRegion"), value: t(`regions.${user.region}`) },
              {
                key: "trustTier",
                label: t("users.columnTrustTier"),
                value: <Badge variant="secondary">{user.trustTier}</Badge>,
              },
              {
                key: "status",
                label: t("users.columnStatus"),
                value: user.isSuspended ? (
                  <StatusBadge status="danger">{t("users.suspended")}</StatusBadge>
                ) : (
                  <StatusBadge status="success">{t("users.active")}</StatusBadge>
                ),
              },
              {
                key: "available",
                label: t("users.availablePoints"),
                value: (
                  <PointsChip
                    value={user.availablePoints}
                    formatLabel={(formatted) => t("users.pointsLabel", { formatted })}
                  />
                ),
              },
              {
                key: "pending",
                label: t("users.pendingPoints"),
                value: (
                  <PointsChip
                    value={user.pendingPoints}
                    formatLabel={(formatted) => t("users.pointsLabel", { formatted })}
                  />
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      {canSuspend ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">
              {user.isSuspended ? t("users.releaseTitle") : t("users.suspendTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user.isSuspended ? (
              <form action={releaseUserAction} className="flex flex-col gap-3">
                {hiddenFields}
                <p className="text-body-sm text-fg-muted">{t("users.releaseDescription")}</p>
                <Button type="submit" className="w-fit">
                  {t("users.releaseSubmit")}
                </Button>
              </form>
            ) : (
              <form action={suspendUserAction} className="flex flex-col gap-3">
                {hiddenFields}
                <Textarea name="reason" label={t("users.reasonLabel")} required />
                <Button type="submit" variant="danger" className="w-fit">
                  {t("users.suspendSubmit")}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canGoodwill ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("users.goodwillTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={goodwillAction} className="flex flex-col gap-3">
              {hiddenFields}
              <Input
                type="number"
                name="points"
                label={t("users.goodwillPointsLabel")}
                min={1}
                required
                className="w-40"
              />
              <Textarea name="reason" label={t("users.reasonLabel")} required />
              <Button type="submit" className="w-fit">
                {t("users.goodwillSubmit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {canSuspend ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("users.trustTierTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={setTrustTierAction} className="flex flex-col gap-3">
              {hiddenFields}
              <NativeSelect
                name="trustTier"
                label={t("users.trustTierLabel")}
                defaultValue={String(user.trustTier)}
                className="w-32"
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </NativeSelect>
              <Textarea name="reason" label={t("users.reasonLabel")} required />
              <Button type="submit" className="w-fit">
                {t("users.trustTierSubmit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("users.ledgerTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <EmptyState title={t("users.ledgerEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("users.ledgerTitle")}
              rows={ledger}
              getRowKey={(row) => row.id}
              columns={[
                {
                  key: "kind",
                  header: t("users.ledgerKind"),
                  cell: (row) => t(`users.ledgerKinds.${row.kind}`),
                },
                {
                  key: "points",
                  header: t("users.ledgerPoints"),
                  cell: (row) => (
                    <PointsChip
                      value={row.points}
                      size="sm"
                      formatLabel={(formatted) => t("users.pointsLabel", { formatted })}
                    />
                  ),
                },
                {
                  key: "at",
                  header: t("users.ledgerAt"),
                  cell: (row) => new Date(row.at).toLocaleString(),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
