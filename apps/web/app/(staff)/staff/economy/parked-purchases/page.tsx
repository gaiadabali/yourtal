import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getParkedPurchases } from "@/features/staff/economy/staff-economy-data";
import { StaffEconomySubnav } from "@/features/staff/economy/staff-economy-subnav";
import { StaffParkedPurchasesScreen } from "@/features/staff/economy/staff-parked-purchases-screen";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/economy/parked-purchases`, 5.1.g: card purchases that did not become points, refunded with two-person approval. */
export default async function StaffParkedPurchasesPage(
  props: PageProps<"/staff/economy/parked-purchases">,
) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const region = stringParam(searchParams.region) === "ID" ? "ID" : "AU";
  const t = await getTranslations("staff");
  const data = await getParkedPurchases(region);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("parkedPurchases.pageTitle")}
        description={t("parkedPurchases.pageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/economy/parked-purchases"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffEconomySubnav
        active="parked"
        region={region}
        showRate={session.roles.includes("finance")}
        t={t}
      />
      <StaffParkedPurchasesScreen
        region={region}
        purchases={data.purchases}
        currentStaffId={session.userId}
      />
    </div>
  );
}
