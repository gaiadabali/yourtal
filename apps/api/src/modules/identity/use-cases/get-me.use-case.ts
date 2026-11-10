import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import type { UserProfile } from "@yourtal/contracts/identity/user-profile";
import type {
  BusinessMembershipReader,
  BusinessMembershipSummary,
} from "../persistence/business-membership-reader";
import type { UserProfileRepository } from "../persistence/user-profile.repository";
import type { StaffRoleReader } from "../persistence/staff-role-reader";
import type { GetMeError } from "../me.errors";

export interface Me {
  readonly profile: UserProfile;
  readonly businessMemberships: readonly BusinessMembershipSummary[];
  /** From `identity.staff_role` (1.5.b) — empty for the overwhelming majority of accounts. */
  readonly staffRoles: readonly string[];
  /** 5.13.v: a teen whose guardian has not approved yet; such an account cannot earn (campaign_view.yaml). */
  readonly awaitingGuardian: boolean;
  /** 5.13.ai: a teen whose guardian withdrew approval (`revoked`); earning is refused the same way. */
  readonly guardianWithdrawn: boolean;
}

export async function getMe(
  profiles: UserProfileRepository,
  businessMemberships: BusinessMembershipReader,
  staffRoles: StaffRoleReader,
  userId: string,
  now: Date,
): Promise<Result<Me, GetMeError>> {
  const stored = await profiles.findByUserId(userId);
  if (stored === null) {
    return err({ type: "profile_not_found" });
  }

  const [memberships, roles] = await Promise.all([
    businessMemberships.listForUser(userId),
    staffRoles.listForUser(userId),
  ]);

  const ageBand = ageBandFrom(ageYearsFrom(stored.dateOfBirth, now));
  return ok({
    profile: {
      userId: stored.userId,
      region: stored.region,
      displayLocale: stored.displayLocale,
      displayName: stored.displayName,
      ageBand,
      timezone: stored.timezone,
    },
    businessMemberships: memberships,
    staffRoles: roles,
    awaitingGuardian: ageBand === "teen" && stored.parentConsentStatus === "pending",
    guardianWithdrawn: ageBand === "teen" && stored.parentConsentStatus === "revoked",
  });
}
