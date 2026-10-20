import * as z from "zod";
import { passwordSignInResultSchema } from "@yourtal/contracts/identity/sign-in-methods";

/** `POST /api/auth/register` (and a finished sign-in) return this shape (1.4.c). */
export const loginResponseSchema = z.object({
  token: z.string().min(1),
  userId: z.string().min(1),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `POST /api/auth/login` and `/password/reset/confirm`: a session, or a request for an authenticator-app code first. */
export const passwordSignInResponseSchema = passwordSignInResultSchema;

/** `POST /api/auth/logout`'s response. */
export const logoutResponseSchema = z.object({
  loggedOut: z.boolean(),
});
