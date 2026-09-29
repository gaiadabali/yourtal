import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { listStaffDisputes } from "@/features/staff/disputes/staff-disputes-data";
import { StaffDisputesList } from "@/features/staff/disputes/staff-disputes-list";

/** `/staff/disputes`, TASKS.md 9.4.d, K13: the captured-voucher dispute queue. */
export default async function StaffDisputesPage() {
  await requireStaffSession();
  const t = await getTranslations("staff");
  const disputes = await listStaffDisputes();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("disputes.title")} description={t("disputes.intro")} />
      <StaffDisputesList disputes={disputes} />
    </div>
  );
}
