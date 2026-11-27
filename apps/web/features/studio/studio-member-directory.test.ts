import { describe, expect, it } from "vitest";
import type { BusinessMember, TeamMember } from "@yourtal/contracts/business/member";
import { demoProfiles, profilesFromTeam, resolveMemberProfile } from "./studio-member-directory";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

function team(userId: string, displayName: string | null, email: string | null): TeamMember {
  return {
    businessId: BUSINESS_ID,
    userId,
    role: "owner",
    invitedAt: "2026-01-01T00:00:00.000Z",
    invitedByUserId: userId,
    joinedAt: "2026-01-01T00:00:00.000Z",
    displayName,
    email,
  };
}

describe("profilesFromTeam (10.7.d)", () => {
  it("shows the account's real name and email", () => {
    const profiles = profilesFromTeam([team("u-1", "Hansel Clement", "hansel@example.com")]);
    expect(profiles["u-1"]).toEqual({ name: "Hansel Clement", email: "hansel@example.com" });
  });

  it("falls back to the email when no name is set", () => {
    const profiles = profilesFromTeam([team("u-1", null, "hansel@example.com")]);
    expect(profiles["u-1"]).toEqual({ name: "hansel@example.com", email: "hansel@example.com" });
  });

  it("leaves out a member with neither, so no one is given an invented name", () => {
    expect(profilesFromTeam([team("u-1", null, null)])).toEqual({});
  });
});

describe("resolveMemberProfile", () => {
  it("never invents a name or an address for someone it does not know", () => {
    const unknown = resolveMemberProfile({}, "11111111-2222-4333-8444-555555555555", "Team member");
    expect(unknown).toEqual({ name: "Team member", email: "" });
    expect(JSON.stringify(unknown)).not.toMatch(/example\.invalid|Casey|11111111/);
  });
});

describe("demoProfiles (mock mode)", () => {
  it("knows the demo cast and nobody else", () => {
    const member = (userId: string): BusinessMember => ({
      businessId: BUSINESS_ID,
      userId,
      role: "admin",
      invitedAt: "2026-01-01T00:00:00.000Z",
      invitedByUserId: userId,
      joinedAt: null,
    });
    const profiles = demoProfiles([
      member("00000000-0000-4000-8000-000000000710"),
      member("someone-else"),
    ]);
    expect(profiles["00000000-0000-4000-8000-000000000710"]?.name).toBe("Budi Santoso");
    expect(profiles["someone-else"]).toBeUndefined();
  });
});
