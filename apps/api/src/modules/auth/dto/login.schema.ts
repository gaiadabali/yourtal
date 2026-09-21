import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/**
 * No `.min(12)` on the password here, unlike `register.schema.ts` — a
 * login DTO validates SHAPE, not policy. Rejecting a login attempt for
 * "too short" before ever reaching the credential check would leak that
 * the policy exists and its exact bound, and would be flatly wrong for an
 * account whose password predates any future policy tightening.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  password: z.string().min(1).max(256),
});

export type LoginRequest = z.infer<typeof loginSchema>;

export class LoginDto extends createZodDto(loginSchema) {}
