import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getEconomyOverview } from "@/features/staff/economy/staff-economy-data";
import { flashFrom } from "@/features/staff/economy/staff-economy-flash";
import { StaffEconomyOverviewScreen } from "@/features/staff/economy/staff-economy-overview-screen";
import { StaffEconomySubnav } from "@/features/staff/economy/staff-economy-subnav";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/economy`, TASKS.md 9.5.a/9.5.c: coverage, daily issuance/reserve/spread, and manual point purchases. */
export default async function StaffEconomyOverviewPage(props: PageProps<"/staff/economy">) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const regionParam = stringParam(searchParams.region);
  const region = regionParam === "ID" ? "ID" : "AU";
  const t = await getTranslations("staff");

  const overview = await getEconomyOverview(region);
  const idempotencyKey = crypto.randomUUID();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("economy.overviewPageTitle")}
        description={t("economy.overviewPageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/economy"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffEconomySubnav
        active="overview"
        region={region}
        showRate={session.roles.includes("finance")}
        t={t}
      />
      <StaffEconomyOverviewScreen
        t={t}
        region={region}
        overview={overview}
        canRecordPurchase={session.roles.includes("finance")}
        currentStaffId={session.userId}
        idempotencyKey={idempotencyKey}
        flash={flashFrom(searchParams, ["proposed", "approved", "error", "invalid"])}
      />
    </div>
  );
}
