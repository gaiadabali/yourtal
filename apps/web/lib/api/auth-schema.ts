import { z } from "zod";

/** `POST /api/auth/login` and `/register` both return this shape (1.4.c). */
export const loginResponseSchema = z.object({
  token: z.string().min(1),
  userId: z.string().min(1),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `POST /api/auth/logout`'s response. */
export const logoutResponseSchema = z.object({
  loggedOut: z.boolean(),
});
