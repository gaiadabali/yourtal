import { describe, expect, it } from "vitest";
import { changeMemberRoleSchema } from "./change-member-role.schema";

describe("changeMemberRoleSchema", () => {
  it("round-trips a valid role change", () => {
    expect(changeMemberRoleSchema.parse({ role: "analyst" })).toStrictEqual({ role: "analyst" });
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "owner role — only transfer_ownership may grant it", input: { role: "owner" } },
    { name: "unknown role value", input: { role: "ceo" } },
    { name: "missing role", input: {} },
    { name: "non-string role", input: { role: 1 } },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(changeMemberRoleSchema.safeParse(input).success).toBe(false);
  });
});
