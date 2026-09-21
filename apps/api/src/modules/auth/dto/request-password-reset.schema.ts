import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
});

export type RequestPasswordResetRequest = z.infer<typeof requestPasswordResetSchema>;

export class RequestPasswordResetDto extends createZodDto(requestPasswordResetSchema) {}
