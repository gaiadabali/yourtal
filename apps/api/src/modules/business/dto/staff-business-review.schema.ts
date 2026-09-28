import { createZodDto } from "nestjs-zod";
import {
  approveBusinessKybRequestSchema,
  reinstateBusinessRequestSchema,
  rejectBusinessKybRequestSchema,
  suspendBusinessRequestSchema,
} from "@yourtal/contracts/staff/businesses";

/** TASKS.md 9.3.a: every one of these carries a required staff `reason`, for the audit trail. */
export class ApproveBusinessKybDto extends createZodDto(approveBusinessKybRequestSchema) {}
export class RejectBusinessKybDto extends createZodDto(rejectBusinessKybRequestSchema) {}
export class SuspendBusinessDto extends createZodDto(suspendBusinessRequestSchema) {}
export class ReinstateBusinessDto extends createZodDto(reinstateBusinessRequestSchema) {}
