import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const createVoucherBatchRequestSchema = z.object({
  listingId: z.uuid(),
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(500).nullable().default(null),
});

export type CreateVoucherBatchRequestBody = z.infer<typeof createVoucherBatchRequestSchema>;

export class CreateVoucherBatchRequestDto extends createZodDto(createVoucherBatchRequestSchema) {}
