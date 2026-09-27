import { describe, expect, it } from "vitest";
import { inviteMemberSchema } from "./invite-member.schema";

describe("inviteMemberSchema", () => {
  it("round-trips a valid invite", () => {
    expect(
      inviteMemberSchema.parse({ email: "marketer@example.com", role: "marketer" }),
    ).toStrictEqual({ email: "marketer@example.com", role: "marketer" });
  });

  it("lowercases and trims the email", () => {
    expect(
      inviteMemberSchema.parse({ email: "  Marketer@Example.com  ", role: "marketer" }).email,
    ).toBe("marketer@example.com");
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "not an email", input: { email: "not-an-email", role: "marketer" } },
    { name: "missing role", input: { email: "marketer@example.com" } },
    { name: "unknown role value", input: { email: "marketer@example.com", role: "manager" } },
    {
      name: "owner role — grantable only via transfer_ownership",
      input: { email: "marketer@example.com", role: "owner" },
    },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(inviteMemberSchema.safeParse(input).success).toBe(false);
  });
});
