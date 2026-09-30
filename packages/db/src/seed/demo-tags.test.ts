import { describe, expect, it } from "vitest";
import { interestTagsSchema } from "@yourtal/contracts/interest/tags";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";
import { demoTagsFor } from "./demo-tags";

describe("demo tags (13.11.c)", () => {
  it("gives every taxonomy-backed category 2-5 valid tags, led by the category itself", () => {
    for (const category of contentCategorySchema.options) {
      const tags = demoTagsFor("00000000-0000-4000-8000-000000000001", category);
      if (tags.length === 0) continue; // a regulated category has no taxonomy node
      expect(tags[0]).toBe(category);
      expect(tags.length).toBeGreaterThanOrEqual(2);
      expect(tags.length).toBeLessThanOrEqual(5);
      expect(interestTagsSchema.safeParse(tags).success).toBe(true);
      expect(tags).not.toContain("family-young-children");
    }
  });

  it("is stable per id", () => {
    expect(demoTagsFor("a", "food-and-drink")).toEqual(demoTagsFor("a", "food-and-drink"));
  });
});
