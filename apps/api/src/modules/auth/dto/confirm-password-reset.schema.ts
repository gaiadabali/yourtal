import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: z.string().min(12).max(256),
});

export type ConfirmPasswordResetRequest = z.infer<typeof confirmPasswordResetSchema>;

export class ConfirmPasswordResetDto extends createZodDto(confirmPasswordResetSchema) {}
