import type { BusinessMember, TeamMember } from "@yourtal/contracts/business/member";

/**
 * Who a team member is, for the Team page and its audit trail.
 *
 * Live, the API sends each member's real display name and sign-in email
 * (`GET .../business/team`, `teamMemberSchema`). Mock mode has no accounts, so it keeps a
 * fixed demo cast. Anyone neither source knows gets a plain "Team member" label and no email,
 * never an invented name or address.
 */
export interface MemberProfile {
  name: string;
  email: string;
}

/** A lookup by user id; a person missing from it is shown with the unknown-member label. */
export type MemberProfiles = Readonly<Record<string, MemberProfile>>;

const DEMO_CAST: MemberProfiles = {
  "00000000-0000-4000-8000-000000000701": {
    name: "Dewi Marketer",
    email: "dewi@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000710": {
    name: "Budi Santoso",
    email: "budi@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000711": {
    name: "Citra Wulandari",
    email: "citra@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000712": {
    name: "Eka Pratama",
    email: "eka@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000713": {
    name: "Fajar Nugroho",
    email: "fajar@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000714": {
    name: "Gita Ramadhani",
    email: "gita@kopikenangan.example",
  },
};

/** Live: the real name and email off each row. A name never set falls back to the email; a row with neither is left out. */
export function profilesFromTeam(members: readonly TeamMember[]): MemberProfiles {
  const profiles: Record<string, MemberProfile> = {};
  for (const member of members) {
    const name = member.displayName ?? member.email;
    if (name !== null) profiles[member.userId] = { name, email: member.email ?? "" };
  }
  return profiles;
}

/** Mock: the demo cast, for whichever of these members it knows. */
export function demoProfiles(roster: readonly BusinessMember[]): MemberProfiles {
  const profiles: Record<string, MemberProfile> = {};
  for (const member of roster) {
    const known = DEMO_CAST[member.userId];
    if (known) profiles[member.userId] = known;
  }
  return profiles;
}

/** The profile for an id, or the unknown-member label with no email. */
export function resolveMemberProfile(
  profiles: MemberProfiles,
  userId: string,
  unknownLabel: string,
): MemberProfile {
  return profiles[userId] ?? { name: unknownLabel, email: "" };
}
