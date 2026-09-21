import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/**
 * `.max(256)` on the password guards Argon2id's own cost: without a ceiling
 * a caller could send megabytes of "password" and force the KDF to hash
 * all of it. `.min(12)` is the length floor; this ticket does not implement
 * a breached-password check (HaveIBeenPwned-style), which is a reasonable
 * follow-on rather than something silently skipped.
 */
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  password: z.string().min(12).max(256),
});

export type RegisterRequest = z.infer<typeof registerSchema>;

export class RegisterDto extends createZodDto(registerSchema) {}
