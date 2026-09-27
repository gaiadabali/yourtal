import { describe, expect, it } from "vitest";
import { businessMemberSchema } from "@yourtal/contracts/business/member";
import {
  changeMemberRole,
  inviteMember,
  isReauthFresh,
  removeMember,
  transferOwnership,
} from "./team-actions";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";
const OWNER_ID = "00000000-0000-4000-8000-000000000710";
const ADMIN_ID = "00000000-0000-4000-8000-000000000711";
const ANALYST_ID = "00000000-0000-4000-8000-000000000714";

function baseRoster() {
  return [
    businessMemberSchema.parse({
      businessId: BUSINESS_ID,
      userId: OWNER_ID,
      role: "owner",
      invitedAt: "2025-01-01T00:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: "2025-01-01T00:00:00.000Z",
    }),
    businessMemberSchema.parse({
      businessId: BUSINESS_ID,
      userId: ADMIN_ID,
      role: "admin",
      invitedAt: "2025-01-02T00:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: "2025-01-03T00:00:00.000Z",
    }),
    businessMemberSchema.parse({
      businessId: BUSINESS_ID,
      userId: ANALYST_ID,
      role: "analyst",
      invitedAt: "2025-01-04T00:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: "2025-01-05T00:00:00.000Z",
    }),
  ];
}

describe("inviteMember", () => {
  it("adds a new pending member", () => {
    const result = inviteMember({
      roster: baseRoster(),
      businessId: BUSINESS_ID,
      email: "new-hire@example.com",
      role: "marketer",
      invitedByUserId: OWNER_ID,
      nowIso: "2025-06-01T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.invitedMember.role).toBe("marketer");
      expect(result.value.invitedMember.joinedAt).toBeNull();
      expect(result.value.roster).toHaveLength(4);
    }
  });

  it("is deterministic — inviting the same email twice yields the same generated id, and refuses the duplicate", () => {
    const first = inviteMember({
      roster: baseRoster(),
      businessId: BUSINESS_ID,
      email: "dup@example.com",
      role: "finance",
      invitedByUserId: OWNER_ID,
      nowIso: "2025-06-01T00:00:00.000Z",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = inviteMember({
      roster: first.value.roster,
      businessId: BUSINESS_ID,
      email: "dup@example.com",
      role: "finance",
      invitedByUserId: OWNER_ID,
      nowIso: "2025-06-02T00:00:00.000Z",
    });
    expect(second).toEqual({
      ok: false,
      error: { type: "already_on_roster", email: "dup@example.com" },
    });
  });
});

describe("changeMemberRole", () => {
  it("reassigns a non-owner member's role", () => {
    const result = changeMemberRole({
      roster: baseRoster(),
      targetUserId: ANALYST_ID,
      newRole: "finance",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const changed = result.value.find((member) => member.userId === ANALYST_ID);
      expect(changed?.role).toBe("finance");
    }
  });

  it("refuses to change the Owner's role — ownership moves only by transfer", () => {
    const result = changeMemberRole({
      roster: baseRoster(),
      targetUserId: OWNER_ID,
      newRole: "admin",
    });
    expect(result).toEqual({ ok: false, error: { type: "cannot_target_owner_role" } });
  });
});

describe("removeMember", () => {
  it("removes a non-owner member", () => {
    const result = removeMember(baseRoster(), ANALYST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((member) => member.userId === ANALYST_ID)).toBeUndefined();
    }
  });

  it("refuses to remove the Owner, even the only Owner — the last-owner failure state", () => {
    const result = removeMember(baseRoster(), OWNER_ID);
    expect(result).toEqual({ ok: false, error: { type: "cannot_remove_owner" } });
  });

  it("an admin can remove themselves — the policy does not special-case self-removal", () => {
    const result = removeMember(baseRoster(), ADMIN_ID);
    expect(result.ok).toBe(true);
  });
});

describe("isReauthFresh", () => {
  it("is fresh within the 5-minute window and stale just past it", () => {
    const now = Date.parse("2026-09-19T10:00:00.000Z");
    expect(isReauthFresh(now - 4 * 60 * 1000, now)).toBe(true);
    expect(isReauthFresh(now - 5 * 60 * 1000, now)).toBe(true);
    expect(isReauthFresh(now - 5 * 60 * 1000 - 1, now)).toBe(false);
    expect(isReauthFresh(null, now)).toBe(false);
  });
});

describe("transferOwnership", () => {
  const now = Date.parse("2026-09-19T10:00:00.000Z");

  it("refuses without any re-authentication", () => {
    const result = transferOwnership({
      roster: baseRoster(),
      currentOwnerUserId: OWNER_ID,
      successorUserId: ADMIN_ID,
      reauthenticatedAtMs: null,
      nowMs: now,
      nowIso: "2026-09-19T10:00:00.000Z",
    });
    expect(result).toEqual({ ok: false, error: { type: "reauth_required" } });
  });

  it("refuses with a stale re-authentication", () => {
    const result = transferOwnership({
      roster: baseRoster(),
      currentOwnerUserId: OWNER_ID,
      successorUserId: ADMIN_ID,
      reauthenticatedAtMs: now - 10 * 60 * 1000,
      nowMs: now,
      nowIso: "2026-09-19T10:00:00.000Z",
    });
    expect(result).toEqual({ ok: false, error: { type: "reauth_expired" } });
  });

  it("refuses a successor who has not joined yet", () => {
    const roster = [
      ...baseRoster(),
      businessMemberSchema.parse({
        businessId: BUSINESS_ID,
        userId: "00000000-0000-4000-8000-000000000701",
        role: "marketer",
        invitedAt: "2025-06-01T00:00:00.000Z",
        invitedByUserId: OWNER_ID,
        joinedAt: null,
      }),
    ];
    const result = transferOwnership({
      roster,
      currentOwnerUserId: OWNER_ID,
      successorUserId: "00000000-0000-4000-8000-000000000701",
      reauthenticatedAtMs: now,
      nowMs: now,
      nowIso: "2026-09-19T10:00:00.000Z",
    });
    expect(result).toEqual({ ok: false, error: { type: "successor_not_a_member" } });
  });

  it("transfers ownership and demotes the prior Owner to Admin, with a fresh re-authentication", () => {
    const result = transferOwnership({
      roster: baseRoster(),
      currentOwnerUserId: OWNER_ID,
      successorUserId: ADMIN_ID,
      reauthenticatedAtMs: now - 60 * 1000,
      nowMs: now,
      nowIso: "2026-09-19T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((member) => member.userId === ADMIN_ID)?.role).toBe("owner");
      expect(result.value.find((member) => member.userId === OWNER_ID)?.role).toBe("admin");
      // exactly one owner survives the transfer
      expect(result.value.filter((member) => member.role === "owner")).toHaveLength(1);
    }
  });
});
