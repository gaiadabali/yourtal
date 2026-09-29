import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getSettingsScreen } from "@/features/staff/economy/staff-economy-data";
import { flashFrom } from "@/features/staff/economy/staff-economy-flash";
import { StaffEconomySettingsScreen } from "@/features/staff/economy/staff-economy-settings-screen";
import { StaffEconomySubnav } from "@/features/staff/economy/staff-economy-subnav";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/economy/settings`, TASKS.md 9.5.d: every F12 setting, per region, including points expiry (F2). */
export default async function StaffEconomySettingsPage(props: PageProps<"/staff/economy/settings">) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const regionParam = stringParam(searchParams.region);
  const region = regionParam === "ID" ? "ID" : "AU";
  const t = await getTranslations("staff");

  const settings = await getSettingsScreen(region);
  const idempotencyKey = crypto.randomUUID();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("economy.settingsPageTitle")}
        description={t("economy.settingsPageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/economy/settings"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffEconomySubnav
        active="settings"
        region={region}
        showRate={session.roles.includes("finance")}
        t={t}
      />
      <StaffEconomySettingsScreen
        t={t}
        region={region}
        settings={settings}
        canPropose={session.roles.includes("finance")}
        currentStaffId={session.userId}
        idempotencyKey={idempotencyKey}
        flash={flashFrom(searchParams, ["proposed", "approved", "error", "invalid"])}
      />
    </div>
  );
}
