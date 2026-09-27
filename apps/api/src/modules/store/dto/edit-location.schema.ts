import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const editLocationSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  address: z.string().min(1).max(200).optional(),
  district: z.string().min(1).max(60).optional(),
});

export type EditLocationRequest = z.infer<typeof editLocationSchema>;

export class EditLocationDto extends createZodDto(editLocationSchema) {}
