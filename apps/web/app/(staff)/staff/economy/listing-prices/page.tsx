import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { getListingPrices } from "@/features/staff/economy/staff-economy-data";
import { StaffEconomySubnav } from "@/features/staff/economy/staff-economy-subnav";
import { StaffListingPricesScreen } from "@/features/staff/economy/staff-listing-prices-screen";
import { StaffRegionSwitch } from "@/features/staff/economy/staff-region-switch";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `/staff/economy/listing-prices`, 2.8.g: a listing's staff-set points price, finance only and two-person. */
export default async function StaffListingPricesPage(
  props: PageProps<"/staff/economy/listing-prices">,
) {
  const session = await requireStaffSession();
  const searchParams = await props.searchParams;
  const region = stringParam(searchParams.region) === "ID" ? "ID" : "AU";
  const query = stringParam(searchParams.q)?.trim();
  const t = await getTranslations("staff");
  const screen = await getListingPrices(region, query);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("listingPrices.pageTitle")}
        description={t("listingPrices.pageDescription")}
        actions={
          <StaffRegionSwitch
            basePath="/staff/economy/listing-prices"
            current={region}
            label={t("economy.regionSwitchLabel")}
            regionLabels={{ AU: t("regions.AU"), ID: t("regions.ID") }}
          />
        }
      />
      <StaffEconomySubnav
        active="prices"
        region={region}
        showRate={session.roles.includes("finance")}
        t={t}
      />
      {screen === null ? (
        <EmptyState
          title={t("listingPrices.notAvailableTitle")}
          description={t("listingPrices.notAvailableBody")}
        />
      ) : (
        <StaffListingPricesScreen region={region} screen={screen} currentStaffId={session.userId} />
      )}
    </div>
  );
}
