import { createZodDto } from "nestjs-zod";
import {
  approveCampaignModerationRequestSchema,
  rejectCampaignModerationRequestSchema,
} from "@yourtal/contracts/staff/moderation";

/** TASKS.md 9.2.a: approve carries an optional audience/category override ("confirm or change", 1.1.d); both carry a required `reason` for the audit trail. */
export class ApproveCampaignModerationDto extends createZodDto(
  approveCampaignModerationRequestSchema,
) {}
export class RejectCampaignModerationDto extends createZodDto(
  rejectCampaignModerationRequestSchema,
) {}
