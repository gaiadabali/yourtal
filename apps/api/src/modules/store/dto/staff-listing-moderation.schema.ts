import { createZodDto } from "nestjs-zod";
import {
  approveListingModerationRequestSchema,
  rejectListingModerationRequestSchema,
} from "@yourtal/contracts/staff/moderation";

/** TASKS.md 9.2.a: both carry a required staff `reason`, same as every other staff review action. */
export class ApproveListingModerationDto extends createZodDto(
  approveListingModerationRequestSchema,
) {}
export class RejectListingModerationDto extends createZodDto(
  rejectListingModerationRequestSchema,
) {}
