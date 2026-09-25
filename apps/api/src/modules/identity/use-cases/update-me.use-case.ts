import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type {
  UserProfileRepository,
  UserProfileUpdate,
} from "../persistence/user-profile.repository";
import type { UpdateMeError } from "../me.errors";

/** `PATCH /api/me` (1.4.d) — display name and locale only; never `region`. */
export async function updateMe(
  profiles: UserProfileRepository,
  userId: string,
  patch: UserProfileUpdate,
): Promise<Result<void, UpdateMeError>> {
  const existing = await profiles.findByUserId(userId);
  if (existing === null) {
    return err({ type: "profile_not_found" });
  }
  await profiles.update(userId, patch);
  return ok(undefined);
}
