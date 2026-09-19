import { describe, expect, it } from "vitest";
import { inviteMemberSchema } from "./invite-member.schema";

describe("inviteMemberSchema", () => {
  it("round-trips a valid invite", () => {
    expect(inviteMemberSchema.parse({ userId: "user-1", role: "marketer" })).toStrictEqual({
      userId: "user-1",
      role: "marketer",
    });
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "empty userId", input: { userId: "", role: "marketer" } },
    { name: "missing role", input: { userId: "user-1" } },
    { name: "unknown role value", input: { userId: "user-1", role: "manager" } },
    {
      name: "owner role — grantable only via transfer_ownership",
      input: { userId: "user-1", role: "owner" },
    },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(inviteMemberSchema.safeParse(input).success).toBe(false);
  });
});
