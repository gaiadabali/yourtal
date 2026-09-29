import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import type { Region } from "@yourtal/contracts/region";
import { requireStaffSession } from "@/features/staff/staff-session";
import { listRiskQueue } from "@/features/staff/risk/staff-risk-data";
import { StaffRiskList } from "@/features/staff/risk/staff-risk-list";
import { StaffRiskRegionForm } from "@/features/staff/risk/staff-risk-region-form";

export const dynamic = "force-dynamic";

function regionParam(value: string | string[] | undefined): Region {
  return value === "ID" ? "ID" : "AU";
}

/**
 * `/staff/risk` (TASKS.md 10.5.a): the real RiskGate's manual-review queue
 * (10.4.b) -- why an account was flagged, then release or suspend it into
 * escrow, each behind a required-reason dialog. `region` is required by the
 * API (F2: each region is its own economy), so this page always passes one,
 * defaulting to AU.
 */
export default async function StaffRiskPage(props: PageProps<"/staff/risk">) {
  await requireStaffSession();
  const searchParams = await props.searchParams;
  const region = regionParam(searchParams.region);
  const t = await getTranslations("staff");
  const flags = await listRiskQueue(region);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("risk.title")} description={t("risk.intro")} />
      <StaffRiskRegionForm t={t} defaultRegion={region} />
      <StaffRiskList initial={flags} />
    </div>
  );
}
