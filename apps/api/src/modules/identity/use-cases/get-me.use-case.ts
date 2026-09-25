import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import type { UserProfile } from "@yourtal/contracts/identity/user-profile";
import type { BusinessMembershipReader, BusinessMembershipSummary } from "../persistence/business-membership-reader";
import type { UserProfileRepository } from "../persistence/user-profile.repository";
import type { GetMeError } from "../me.errors";

export interface Me {
  readonly profile: UserProfile;
  readonly businessMemberships: readonly BusinessMembershipSummary[];
  /**
   * Always empty until 1.5.b adds `identity.staff_role` — an honest empty
   * list, not a fake one, since nothing has ever been able to hold a staff
   * role before that table exists.
   */
  readonly staffRoles: readonly string[];
}

export async function getMe(
  profiles: UserProfileRepository,
  businessMemberships: BusinessMembershipReader,
  userId: string,
  now: Date,
): Promise<Result<Me, GetMeError>> {
  const stored = await profiles.findByUserId(userId);
  if (stored === null) {
    return err({ type: "profile_not_found" });
  }

  const memberships = await businessMemberships.listForUser(userId);

  return ok({
    profile: {
      userId: stored.userId,
      region: stored.region,
      displayLocale: stored.displayLocale,
      displayName: stored.displayName,
      ageBand: ageBandFrom(ageYearsFrom(stored.dateOfBirth, now)),
      timezone: stored.timezone,
    },
    businessMemberships: memberships,
    staffRoles: [],
  });
}
