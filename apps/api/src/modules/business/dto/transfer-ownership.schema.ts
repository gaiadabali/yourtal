import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1),
});

export type TransferOwnershipRequest = z.infer<typeof transferOwnershipSchema>;

export class TransferOwnershipDto extends createZodDto(transferOwnershipSchema) {}
