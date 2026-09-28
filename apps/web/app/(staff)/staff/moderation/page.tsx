import { getTranslations } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { listPendingVoucherBatches } from "@/features/staff/moderation/staff-moderation-data";
import { StaffVoucherBatchList } from "@/features/staff/moderation/staff-voucher-batch-list";

export const dynamic = "force-dynamic";

/**
 * `/staff/moderation` (TASKS.md 9.2.c): the voucher-batch half of the
 * moderation queue. The rest (9.2.a) lands once 7.3 does, as its own
 * section on this same page.
 */
export default async function StaffModerationPage() {
  await requireStaffSession();
  const [t, requests] = await Promise.all([getTranslations("staff"), listPendingVoucherBatches()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("moderation.pageTitle")} description={t("moderation.pageDescription")} />
      <StaffVoucherBatchList initial={requests} />
    </div>
  );
}
