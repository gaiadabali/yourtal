import { describe, expect, it } from "vitest";
import { businessTeamRoleSchema } from "./business-team-role";
import { businessRoleSchema } from "./business";

describe("businessTeamRoleSchema", () => {
  it("is exactly the six roles in docs/17 section 2.1", () => {
    expect(businessTeamRoleSchema.options).toEqual([
      "owner",
      "admin",
      "marketer",
      "merchandiser",
      "finance",
      "analyst",
    ]);
  });

  it.each(["owner", "admin", "marketer", "merchandiser", "finance", "analyst"])(
    "accepts %s",
    (role) => {
      expect(businessTeamRoleSchema.parse(role)).toBe(role);
    },
  );

  it.each([
    ["store staff, who are device sessions and not members (docs/17 2.2)", "store_staff"],
    ["a device role from the authorization layer", "store_device"],
    ["a platform relationship rather than a person's job", "advertiser"],
    ["an internal role", "support"],
    ["the wrong case", "Owner"],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(businessTeamRoleSchema.safeParse(value).success).toBe(false);
  });
});

describe("the two things both called a business role", () => {
  it("do not overlap at all", () => {
    // `businessRoleSchema` (./business.ts) is the RELATIONSHIPS a business
    // holds with the platform; this one is the JOB a person does inside it.
    // They were both called "business role" once, which is how a member
    // record ends up carrying "supplier" as somebody's job title.
    // Widened through a Set rather than a cast — `as` is banned in this
    // package (docs/13b section 2), and the two option lists are disjoint
    // literal unions that TypeScript will not let us compare directly.
    const relationships = new Set<string>(businessRoleSchema.options);
    const overlap = businessTeamRoleSchema.options.filter((role) => relationships.has(role));

    expect(overlap).toEqual([]);
  });

  it("rejects each other's values", () => {
    for (const relationship of businessRoleSchema.options) {
      expect(businessTeamRoleSchema.safeParse(relationship).success, relationship).toBe(false);
    }
    for (const job of businessTeamRoleSchema.options) {
      expect(businessRoleSchema.safeParse(job).success, job).toBe(false);
    }
  });
});
