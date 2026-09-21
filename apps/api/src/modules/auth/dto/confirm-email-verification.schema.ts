import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const confirmEmailVerificationSchema = z.object({
  token: z.string().min(1).max(512),
});

export type ConfirmEmailVerificationRequest = z.infer<typeof confirmEmailVerificationSchema>;

export class ConfirmEmailVerificationDto extends createZodDto(confirmEmailVerificationSchema) {}
