import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getReceiptProgrammes } from "@/features/staff/economy/staff-economy-data";
import { StaffEconomyReceiptsScreen } from "@/features/staff/economy/staff-economy-receipts-screen";
import { StaffEconomySubnav } from "@/features/staff/economy/staff-economy-subnav";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/economy/receipts`, TASKS.md 2.9.c: SnapApp's receipt programme. Finance and ops. */
export default async function StaffEconomyReceiptsPage(
  props: PageProps<"/staff/economy/receipts">,
) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const region = stringParam(searchParams.region) === "ID" ? "ID" : "AU";
  const t = await getTranslations("staff");

  const programmes = await getReceiptProgrammes(region);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("economy.receiptsPageTitle")}
        description={t("economy.receiptsPageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/economy/receipts"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffEconomySubnav
        active="receipts"
        region={region}
        showRate={session.roles.includes("finance")}
        t={t}
      />
      <StaffEconomyReceiptsScreen t={t} programmes={programmes} />
    </div>
  );
}
