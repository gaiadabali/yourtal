import { z } from "zod";
import { userProfileSchema } from "@yourtal/contracts/identity/user-profile";

/**
 * `GET`/`PATCH /api/me`'s response shape (1.4.d's `Me` interface in
 * `apps/api/src/modules/identity/use-cases/get-me.use-case.ts`), restated as
 * a runtime Zod schema so `apiFetch` can validate it. Kept in `apps/web/lib/api`
 * rather than `packages/contracts` because this is a read shape one
 * controller composes from three sources (profile, business memberships,
 * staff roles) — there is no wire contract for `Me` as a whole, only
 * `userProfileSchema` for its `profile` field.
 */
export const meResponseSchema = z.object({
  profile: userProfileSchema,
  businessMemberships: z.array(
    z.object({
      businessId: z.string().min(1),
      role: z.string().min(1),
    }),
  ),
  staffRoles: z.array(z.string()),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
