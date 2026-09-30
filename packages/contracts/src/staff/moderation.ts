import { z } from "zod";
import { audienceSchema } from "../campaign/campaign";
import { campaignLifecycleStateSchema } from "../campaign/campaign-lifecycle";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";

/**
 * TASKS.md 9.2.c: the staff moderation queue's voucher-batch half --
 * `apps/api/src/modules/store/staff-voucher-batch-review.controller.ts`.
 * Mirrors `apps/api`'s own `VoucherBatchRequest` (store/persistence/
 * voucher-batch-request.repository.ts), which the merchant-facing
 * `VoucherBatchRequestController` already returns with no contracts-package
 * schema of its own -- this is the first one to need a documented shape
 * (the staff console reads it), so it is defined here rather than promoted
 * onto that undocumented interface.
 */
export const staffVoucherBatchRequestSchema = z
  .object({
    id: z.uuid(),
    listingId: z.uuid(),
    merchantId: z.uuid(),
    quantity: z.number().int().positive(),
    requestedBy: z.uuid(),
    reason: z.string().nullable(),
    state: z.enum(["pending", "approved", "rejected"]),
    approvedBy: z.uuid().nullable(),
    decidedAt: z.iso.datetime({ offset: true }).nullable(),
    mintedBatchId: z.string().min(1).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type StaffVoucherBatchRequest = z.infer<typeof staffVoucherBatchRequestSchema>;

export const listPendingVoucherBatchesResponseSchema = z
  .object({ requests: z.array(staffVoucherBatchRequestSchema) })
  .strict();
export type ListPendingVoucherBatchesResponse = z.infer<
  typeof listPendingVoucherBatchesResponseSchema
>;

const staffReasonSchema = z.object({ reason: z.string().min(1).max(500) });

/** Both carry a required `reason` for the audit trail, same as 9.3.a's staff/businesses. */
export const approveVoucherBatchRequestSchema = staffReasonSchema;
export type ApproveVoucherBatchRequest = z.infer<typeof approveVoucherBatchRequestSchema>;

export const rejectVoucherBatchRequestSchema = staffReasonSchema;
export type RejectVoucherBatchRequest = z.infer<typeof rejectVoucherBatchRequestSchema>;

/**
 * TASKS.md 9.2.a: the campaign-creative half of the moderation queue --
 * `apps/api/src/modules/studio/staff-campaign-moderation.controller.ts`.
 * The automated screen's flags (question-bank PII/prediction, re-run at
 * review time -- `staff-campaign-moderation.use-cases.ts`), shown to the
 * moderator alongside the campaign itself.
 */
export const campaignModerationFlagSchema = z
  .object({
    questionId: z.uuid(),
    kind: z.enum(["pii", "prediction"]),
    category: z.string().optional(),
    reason: z.string(),
  })
  .strict();
export type CampaignModerationFlag = z.infer<typeof campaignModerationFlagSchema>;

/** Studio's own authoring shape, trimmed to what a moderator needs to decide. */
export const staffCampaignModerationCampaignSchema = z
  .object({
    id: z.uuid(),
    businessId: z.uuid(),
    region: z.enum(["AU", "ID"]),
    title: z.string(),
    synopsis: z.string(),
    audience: audienceSchema,
    contentCategory: contentCategorySchema,
    lifecycleState: campaignLifecycleStateSchema,
    rejectionReason: z.string().nullable(),
    posterUrl: z.string().nullable(),
    teaserUrl: z.string().nullable(),
  })
  .strict();
export type StaffCampaignModerationCampaign = z.infer<typeof staffCampaignModerationCampaignSchema>;

export const campaignModerationQueueItemSchema = z
  .object({
    campaign: staffCampaignModerationCampaignSchema,
    flags: z.array(campaignModerationFlagSchema),
  })
  .strict();
export type CampaignModerationQueueItem = z.infer<typeof campaignModerationQueueItemSchema>;

export const listCampaignModerationQueueResponseSchema = z
  .object({ items: z.array(campaignModerationQueueItemSchema) })
  .strict();
export type ListCampaignModerationQueueResponse = z.infer<
  typeof listCampaignModerationQueueResponseSchema
>;

/**
 * "Confirm or change" (1.1.d): a moderator may override the declared
 * audience/category before approving. Both optional -- omitting either
 * confirms the business's own value unchanged.
 */
export const approveCampaignModerationRequestSchema = z
  .object({
    reason: z.string().min(1).max(500),
    audience: audienceSchema.optional(),
    contentCategory: contentCategorySchema.optional(),
  })
  .strict();
export type ApproveCampaignModerationRequest = z.infer<
  typeof approveCampaignModerationRequestSchema
>;

export const rejectCampaignModerationRequestSchema = staffReasonSchema;
export type RejectCampaignModerationRequest = z.infer<typeof rejectCampaignModerationRequestSchema>;

/**
 * TASKS.md 9.2.a: the listing half of the moderation queue --
 * `apps/api/src/modules/store/staff-listing-moderation.controller.ts`.
 * Only a listing the automated screen flagged (an `adult_only` category,
 * per 1.1.d) ever reaches `pending_review`; every other listing goes
 * straight to `active`, unchanged from before this task.
 */
export const staffListingModerationItemSchema = z
  .object({
    id: z.uuid(),
    merchantId: z.uuid(),
    merchantName: z.string(),
    title: z.string(),
    region: z.enum(["AU", "ID"]),
    audience: audienceSchema,
    contentCategory: contentCategorySchema,
    lifecycleState: z.enum(["pending_review", "active", "rejected", "paused", "retired"]),
    rejectionReason: z.string().nullable(),
  })
  .strict();
export type StaffListingModerationItem = z.infer<typeof staffListingModerationItemSchema>;

export const listPendingListingModerationResponseSchema = z
  .object({ listings: z.array(staffListingModerationItemSchema) })
  .strict();
export type ListPendingListingModerationResponse = z.infer<
  typeof listPendingListingModerationResponseSchema
>;

/**
 * 12.4.c (F83): "confirm or change" (1.1.d), the same shape
 * `approveCampaignModerationRequestSchema` above already gives campaigns --
 * a moderator may override the declared audience/category before approving
 * a flagged listing too. Both optional -- omitting either confirms the
 * business's own value unchanged.
 */
export const approveListingModerationRequestSchema = z
  .object({
    reason: z.string().min(1).max(500),
    audience: audienceSchema.optional(),
    contentCategory: contentCategorySchema.optional(),
  })
  .strict();
export type ApproveListingModerationRequest = z.infer<typeof approveListingModerationRequestSchema>;

export const rejectListingModerationRequestSchema = staffReasonSchema;
export type RejectListingModerationRequest = z.infer<typeof rejectListingModerationRequestSchema>;
