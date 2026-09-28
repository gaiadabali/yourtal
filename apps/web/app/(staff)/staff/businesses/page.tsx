import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { listStaffBusinesses } from "@/features/staff/businesses/staff-businesses-data";
import { StaffBusinessesList } from "@/features/staff/businesses/staff-businesses-list";

export interface StaffBusinessesPageProps {
  readonly searchParams: Promise<{ search?: string; region?: string }>;
}

/** `/staff/businesses` (TASKS.md 9.3.a): search/list every business, with its KYB and suspension status. */
export default async function StaffBusinessesPage({ searchParams }: StaffBusinessesPageProps) {
  await requireStaffSession();
  const params = await searchParams;
  const search = params.search ?? "";
  const [t, { businesses, total }] = await Promise.all([
    getTranslations("staff"),
    listStaffBusinesses({
      search,
      ...(params.region === "AU" || params.region === "ID" ? { region: params.region } : {}),
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("businesses.pageTitle")} description={t("businesses.pageDescription")} />
      <StaffBusinessesList businesses={businesses} total={total} search={search} />
    </div>
  );
}
