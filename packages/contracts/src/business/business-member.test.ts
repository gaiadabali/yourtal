import { describe, expect, it } from "vitest";
import { businessMemberSchema } from "./business-member";
import {
  generateBusinessMember,
  generateBusinessMembers,
  mockBusinessMembers,
} from "./business-member.mock";

const valid = {
  businessId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  role: "marketer",
  invitedAt: "2026-01-01T00:00:00Z",
  invitedByUserId: "owner-1",
  joinedAt: null,
};

describe("businessMemberSchema", () => {
  it("round-trips a valid member", () => {
    expect(businessMemberSchema.parse(valid)).toMatchObject({ role: "marketer" });
  });

  it("round-trips a joined member", () => {
    expect(
      businessMemberSchema.safeParse({ ...valid, joinedAt: "2026-01-02T00:00:00Z" }).success,
    ).toBe(true);
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "non-uuid businessId", overrides: { businessId: "not-a-uuid" } },
    { name: "empty userId", overrides: { userId: "" } },
    { name: "invalid role enum value", overrides: { role: "advertiser" } },
    { name: "missing role", overrides: { role: undefined } },
    { name: "non-RFC3339 invitedAt", overrides: { invitedAt: "yesterday" } },
    { name: "empty invitedByUserId", overrides: { invitedByUserId: "" } },
    { name: "joinedAt not a date or null", overrides: { joinedAt: "not-a-date" } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...valid, ...overrides };
    expect(businessMemberSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateBusinessMember determinism", () => {
  it("produces byte-identical output for the same seed", () => {
    const first = generateBusinessMember({ seed: 3 });
    const second = generateBusinessMember({ seed: 3 });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateBusinessMembers(8, 7_000)).toStrictEqual(mockBusinessMembers);
  });
});
