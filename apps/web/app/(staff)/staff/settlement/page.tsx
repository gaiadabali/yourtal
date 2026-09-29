import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { flashFrom } from "@/features/staff/economy/staff-economy-flash";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";
import {
  getPayoutProposals,
  getSettlementQueue,
} from "@/features/staff/settlement/staff-settlement-data";
import { StaffSettlementScreen } from "@/features/staff/settlement/staff-settlement-screen";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/settlement`, TASKS.md 10.6.a: weekly statements, disputes and payout approval. */
export default async function StaffSettlementPage(props: PageProps<"/staff/settlement">) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const regionParam = stringParam(searchParams.region);
  const region = regionParam === "ID" ? "ID" : "AU";
  const t = await getTranslations("staff");

  const [queue, payoutProposals] = await Promise.all([
    getSettlementQueue(region),
    getPayoutProposals(region),
  ]);
  const idempotencyKey = crypto.randomUUID();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("settlement.pageTitle")}
        description={t("settlement.pageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/settlement"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffSettlementScreen
        t={t}
        region={region}
        queue={queue}
        payoutProposals={payoutProposals}
        canResolveDispute={session.roles.includes("finance") || session.roles.includes("ops")}
        canProposePayout={session.roles.includes("finance")}
        currentStaffId={session.userId}
        idempotencyKey={idempotencyKey}
        flash={flashFrom(searchParams, ["resolved", "proposed", "approved", "error", "invalid"])}
      />
    </div>
  );
}
