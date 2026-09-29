import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import {
  getKillSwitches,
  getMarketingFundings,
} from "@/features/staff/economy/staff-economy-data";
import { flashFrom } from "@/features/staff/economy/staff-economy-flash";
import { StaffEconomyMarketingScreen } from "@/features/staff/economy/staff-economy-marketing-screen";
import { StaffEconomySubnav } from "@/features/staff/economy/staff-economy-subnav";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/economy/marketing`, TASKS.md 9.5.c: marketing funding (two-person) and kill switches (ops). */
export default async function StaffEconomyMarketingPage(props: PageProps<"/staff/economy/marketing">) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const regionParam = stringParam(searchParams.region);
  const region = regionParam === "ID" ? "ID" : "AU";
  const t = await getTranslations("staff");

  const [fundings, killSwitches] = await Promise.all([
    getMarketingFundings(region),
    getKillSwitches(),
  ]);
  const idempotencyKey = crypto.randomUUID();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("economy.marketingPageTitle")}
        description={t("economy.marketingPageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/economy/marketing"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffEconomySubnav
        active="marketing"
        region={region}
        showRate={session.roles.includes("finance")}
        t={t}
      />
      <StaffEconomyMarketingScreen
        t={t}
        region={region}
        fundings={fundings}
        killSwitches={killSwitches}
        canFund={session.roles.includes("finance")}
        canTripKillSwitch={session.roles.includes("ops")}
        currentStaffId={session.userId}
        idempotencyKey={idempotencyKey}
        flash={flashFrom(searchParams, ["proposed", "approved", "killSwitch", "error", "invalid"])}
      />
    </div>
  );
}
