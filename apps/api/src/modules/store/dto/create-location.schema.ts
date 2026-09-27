import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** `merchantId` is always the route's `:tenantId` -- see `create-listing.schema.ts`'s header. */
export const createLocationSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().min(1).max(200),
  district: z.string().min(1).max(60),
});

export type CreateLocationRequest = z.infer<typeof createLocationSchema>;

export class CreateLocationDto extends createZodDto(createLocationSchema) {}
