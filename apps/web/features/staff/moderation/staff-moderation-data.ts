import "server-only";

import {
  listCampaignModerationQueueResponseSchema,
  listPendingListingModerationResponseSchema,
  listPendingVoucherBatchesResponseSchema,
  type CampaignModerationQueueItem,
  type StaffListingModerationItem,
  type StaffVoucherBatchRequest,
} from "@yourtal/contracts/staff/moderation";
import { apiFetch } from "@/lib/api/api-fetch";

/** TASKS.md 9.2.c: the voucher-batch half of the staff moderation queue. */
export async function listPendingVoucherBatches(): Promise<readonly StaffVoucherBatchRequest[]> {
  const result = await apiFetch(
    "/api/staff/moderation/voucher-batches",
    listPendingVoucherBatchesResponseSchema,
  );
  if (!result.ok)
    throw new Error(`Could not load pending voucher batches: ${result.error.message}`);
  return result.data.requests;
}

/** TASKS.md 9.2.a: the campaign-creative half of the staff moderation queue. */
export async function listCampaignModerationQueue(): Promise<
  readonly CampaignModerationQueueItem[]
> {
  const result = await apiFetch(
    "/api/staff/moderation/campaigns",
    listCampaignModerationQueueResponseSchema,
  );
  if (!result.ok)
    throw new Error(`Could not load the campaign moderation queue: ${result.error.message}`);
  return result.data.items;
}

/** TASKS.md 9.2.a: the listing half -- only a listing the automated screen flagged. */
export async function listPendingListingModeration(): Promise<
  readonly StaffListingModerationItem[]
> {
  const result = await apiFetch(
    "/api/staff/moderation/listings",
    listPendingListingModerationResponseSchema,
  );
  if (!result.ok)
    throw new Error(`Could not load pending listing reviews: ${result.error.message}`);
  return result.data.listings;
}
