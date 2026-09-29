import { getTranslations } from "next-intl/server";
import { Heading } from "@yourtal/ui/heading";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import {
  listCampaignModerationQueue,
  listPendingListingModeration,
  listPendingVoucherBatches,
} from "@/features/staff/moderation/staff-moderation-data";
import { StaffCampaignModerationList } from "@/features/staff/moderation/staff-campaign-moderation-list";
import { StaffListingModerationList } from "@/features/staff/moderation/staff-listing-moderation-list";
import { StaffVoucherBatchList } from "@/features/staff/moderation/staff-voucher-batch-list";

export const dynamic = "force-dynamic";

/**
 * `/staff/moderation` (TASKS.md 9.2): campaign creative + question bank,
 * listings and voucher batches, each its own section -- 9.2.c's own queue
 * unchanged, 9.2.a's two queues appended.
 */
export default async function StaffModerationPage() {
  await requireStaffSession();
  const [t, campaignItems, listingItems, voucherRequests] = await Promise.all([
    getTranslations("staff"),
    listCampaignModerationQueue(),
    listPendingListingModeration(),
    listPendingVoucherBatches(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("moderation.pageTitle")} description={t("moderation.pageDescription")} />

      <section className="flex flex-col gap-4">
        <Heading level={2} size="title">
          {t("moderation.campaignsSectionTitle")}
        </Heading>
        <StaffCampaignModerationList initial={campaignItems} />
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2} size="title">
          {t("moderation.listingsSectionTitle")}
        </Heading>
        <StaffListingModerationList initial={listingItems} />
      </section>

      <section className="flex flex-col gap-4">
        <Heading level={2} size="title">
          {t("moderation.voucherBatchesSectionTitle")}
        </Heading>
        <StaffVoucherBatchList initial={voucherRequests} />
      </section>
    </div>
  );
}
