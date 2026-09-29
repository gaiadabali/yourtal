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
  const session = await requireStaffSession();
  // Cerbos scopes each queue's `view` action to the ONE role that reviews
  // it (moderator: campaigns + question banks + voucher batches; ops:
  // listings, per listing.yaml's "ops-approves-listings" rule) -- a staffer
  // with only the other role would 403 on a section they cannot act on
  // anyway, so this page fetches (and renders) only the sections this
  // session's own roles actually reach.
  const canModerate = session.roles.includes("moderator");
  const canReviewListings = session.roles.includes("ops");

  const [t, campaignItems, listingItems, voucherRequests] = await Promise.all([
    getTranslations("staff"),
    canModerate ? listCampaignModerationQueue() : Promise.resolve(null),
    canReviewListings ? listPendingListingModeration() : Promise.resolve(null),
    canModerate ? listPendingVoucherBatches() : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("moderation.pageTitle")} description={t("moderation.pageDescription")} />

      {campaignItems !== null ? (
        <section className="flex flex-col gap-4">
          <Heading level={2} size="title">
            {t("moderation.campaignsSectionTitle")}
          </Heading>
          <StaffCampaignModerationList initial={campaignItems} />
        </section>
      ) : null}

      {listingItems !== null ? (
        <section className="flex flex-col gap-4">
          <Heading level={2} size="title">
            {t("moderation.listingsSectionTitle")}
          </Heading>
          <StaffListingModerationList initial={listingItems} />
        </section>
      ) : null}

      {voucherRequests !== null ? (
        <section className="flex flex-col gap-4">
          <Heading level={2} size="title">
            {t("moderation.voucherBatchesSectionTitle")}
          </Heading>
          <StaffVoucherBatchList initial={voucherRequests} />
        </section>
      ) : null}
    </div>
  );
}
