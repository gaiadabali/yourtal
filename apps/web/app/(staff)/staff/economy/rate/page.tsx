import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getRateScreen } from "@/features/staff/economy/staff-economy-data";
import { flashFrom } from "@/features/staff/economy/staff-economy-flash";
import { StaffEconomyRateScreen } from "@/features/staff/economy/staff-economy-rate-screen";
import { StaffEconomySubnav } from "@/features/staff/economy/staff-economy-subnav";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/economy/rate`, TASKS.md 9.5.b: finance only. B never leaves this screen. */
export default async function StaffEconomyRatePage(props: PageProps<"/staff/economy/rate">) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const regionParam = stringParam(searchParams.region);
  const region = regionParam === "ID" ? "ID" : "AU";
  const t = await getTranslations("staff");

  const rate = await getRateScreen(region);
  const idempotencyKey = crypto.randomUUID();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("economy.ratePageTitle")}
        description={t("economy.ratePageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/economy/rate"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffEconomySubnav
        active="rate"
        region={region}
        showRate={session.roles.includes("finance")}
        t={t}
      />
      <StaffEconomyRateScreen
        t={t}
        region={region}
        rate={rate}
        currentStaffId={session.userId}
        idempotencyKey={idempotencyKey}
        flash={flashFrom(searchParams, ["proposed", "approved", "error", "invalid"])}
      />
    </div>
  );
}
