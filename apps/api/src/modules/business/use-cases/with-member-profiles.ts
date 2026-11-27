import type { BusinessMember, TeamMember } from "@yourtal/contracts/business/member";
import type { AccountEmailReader } from "../../identity/persistence/account-email-reader";
import type { UserProfileRepository } from "../../identity/persistence/user-profile.repository";

/**
 * The roster with each person's real display name and sign-in email, read from their account.
 * Either is `null` when the account has none; the console falls back to the email, never to a
 * made-up name. Looked up per person, once, in parallel (a team is a handful of rows).
 */
export function withMemberProfiles(
  members: readonly BusinessMember[],
  profiles: Pick<UserProfileRepository, "findByUserId">,
  emails: Pick<AccountEmailReader, "emailFor">,
): Promise<TeamMember[]> {
  return Promise.all(
    members.map(async (member) => {
      const [profile, email] = await Promise.all([
        profiles.findByUserId(member.userId),
        emails.emailFor(member.userId),
      ]);
      const displayName = profile?.displayName.trim();
      return { ...member, displayName: displayName ? displayName : null, email };
    }),
  );
}
