import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { regionSchema } from "@yourtal/contracts/region";
import { displayLocaleSchema } from "@yourtal/contracts/identity/user-profile";

/**
 * `.max(256)` on the password guards Argon2id's own cost: without a ceiling
 * a caller could send megabytes of "password" and force the KDF to hash
 * all of it. `.min(12)` is the length floor; this ticket does not implement
 * a breached-password check (HaveIBeenPwned-style), which is a reasonable
 * follow-on rather than something silently skipped.
 *
 * 1.4.c adds region, locale, display name, date of birth, timezone and (when
 * the caller is 13-17 under `TEEN_ACCOUNTS`) a guardian email — everything
 * `identity.user_profile` (1.4.a) needs to exist the moment an account does,
 * rather than a profile row created empty and filled in later.
 */
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  password: z.string().min(12).max(256),
  region: regionSchema,
  /** Independent of `region` — a display-language choice, not a jurisdiction. */
  locale: displayLocaleSchema,
  displayName: z.string().trim().min(1).max(120),
  /** `YYYY-MM-DD`. Discarded unread by `AuthService` for anyone under 13 (1.4.b). */
  dateOfBirth: z.iso.date(),
  /** The browser's IANA zone, e.g. "Australia/Sydney". */
  timezone: z.string().min(1).max(100),
  /** Required only for a 13-17-year-old registering under `TEEN_ACCOUNTS`; ignored otherwise. */
  guardianEmail: z.string().trim().toLowerCase().max(320).pipe(z.email()).optional(),
});

export type RegisterRequest = z.infer<typeof registerSchema>;

export class RegisterDto extends createZodDto(registerSchema) {}
