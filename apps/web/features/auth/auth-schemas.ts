import * as z from "zod";

/**
 * Response shapes for the 1.4 auth endpoints `lib/api/auth-schema.ts`
 * (Area A) does not already cover. `register`'s own response is the exact
 * same `{ token, userId }` shape as login's, so it reuses
 * `loginResponseSchema` rather than repeating it here.
 */

/** `POST /api/auth/password/reset/request` — always `{ requested: true }`; the service never reports whether the email existed (auth.errors.ts). */
export const requestPasswordResetResponseSchema = z.object({
  requested: z.boolean(),
});

/** `POST /api/auth/email/verify/confirm`'s response. */
export const emailVerificationConfirmedSchema = z.object({
  verified: z.boolean(),
});
