import { createZodDto } from "nestjs-zod";
import {
  approveVoucherBatchRequestSchema,
  rejectVoucherBatchRequestSchema,
} from "@yourtal/contracts/staff/moderation";

/** TASKS.md 9.2.c: both carry a required staff `reason`, for the audit trail. */
export class ApproveVoucherBatchDto extends createZodDto(approveVoucherBatchRequestSchema) {}
export class RejectVoucherBatchDto extends createZodDto(rejectVoucherBatchRequestSchema) {}
