import { createZodDto } from "nestjs-zod";
import {
  approveListingModerationRequestSchema,
  rejectListingModerationRequestSchema,
} from "@yourtal/contracts/staff/moderation";

/**
 * TASKS.md 9.2.a: both carry a required staff `reason`, same as every other
 * staff review action. 12.4.c: approve also carries an optional
 * audience/category override ("confirm or change", 1.1.d), the same shape
 * `ApproveCampaignModerationDto` already gives campaigns.
 */
export class ApproveListingModerationDto extends createZodDto(
  approveListingModerationRequestSchema,
) {}
export class RejectListingModerationDto extends createZodDto(
  rejectListingModerationRequestSchema,
) {}
