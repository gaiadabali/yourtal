import { describe, expect, it } from "vitest";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { StoredUserProfile } from "../../identity/persistence/user-profile.repository";
import { withMemberProfiles } from "./with-member-profiles";

const member = (userId: string): BusinessMember => ({
  businessId: "11111111-1111-4111-8111-111111111111",
  userId,
  role: "owner",
  invitedAt: "2026-01-01T00:00:00.000Z",
  invitedByUserId: userId,
  joinedAt: "2026-01-01T00:00:00.000Z",
});

const profileOf = (userId: string, displayName: string) =>
  ({ userId, displayName }) as StoredUserProfile;

describe("withMemberProfiles", () => {
  it("returns each person's real name and email, not a placeholder", async () => {
    const result = await withMemberProfiles(
      [member("u-1")],
      { findByUserId: (id) => Promise.resolve(profileOf(id, "Hansel Clement")) },
      { emailFor: () => Promise.resolve("hansel@example.com") },
    );
    expect(result).toEqual([
      { ...member("u-1"), displayName: "Hansel Clement", email: "hansel@example.com" },
    ]);
  });

  it("gives null, never a made-up value, for an account with no profile, blank name or email", async () => {
    const result = await withMemberProfiles(
      [member("u-1"), member("u-2")],
      {
        findByUserId: (id) => Promise.resolve(id === "u-1" ? null : profileOf(id, "   ")),
      },
      { emailFor: () => Promise.resolve(null) },
    );
    expect(result.map((row) => [row.displayName, row.email])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("keeps the roster's order", async () => {
    const result = await withMemberProfiles(
      [member("u-b"), member("u-a")],
      { findByUserId: (id) => Promise.resolve(profileOf(id, id)) },
      { emailFor: (id) => Promise.resolve(`${id}@example.com`) },
    );
    expect(result.map((row) => row.userId)).toEqual(["u-b", "u-a"]);
  });
});
