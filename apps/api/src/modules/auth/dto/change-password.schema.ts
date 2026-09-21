import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});

export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
