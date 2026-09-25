import { describe, expect, it } from "vitest";
import { PUBLIC_INFO_SLUGS, isPublicInfoSlug, publicInfoPage } from "./public-info-pages";

const LOCALES = ["en-AU", "id-ID"] as const;

describe("public info pages", () => {
  it.each(LOCALES)("every page has a title, description and sections in %s", (locale) => {
    for (const slug of PUBLIC_INFO_SLUGS) {
      const page = publicInfoPage(locale, slug);
      expect(page.title, slug).not.toBe("");
      expect(page.description, slug).not.toBe("");
      expect(page.sections.length, slug).toBeGreaterThan(0);
      for (const section of page.sections) expect(section.body.length).toBeGreaterThan(0);
    }
  });

  it("marks only terms and privacy as legal, and only business has a call to action", () => {
    const legal = PUBLIC_INFO_SLUGS.filter((slug) => publicInfoPage("en-AU", slug).isLegal);
    expect(legal).toStrictEqual(["terms", "privacy"]);
    expect(publicInfoPage("en-AU", "for-business").cta?.href).toBe("/business");
    expect(publicInfoPage("en-AU", "help").cta).toBeNull();
  });

  it("keeps earnings language out of the non-legal pages", () => {
    const banned = /get paid|money|income|salary|cash|wage/i;
    for (const slug of PUBLIC_INFO_SLUGS) {
      const page = publicInfoPage("en-AU", slug);
      if (page.isLegal) continue;
      const text = [page.title, page.lead, ...page.sections.flatMap((s) => [s.heading, ...s.body])];
      for (const line of text) expect(line, slug).not.toMatch(banned);
    }
  });

  it("rejects unknown slugs, including inherited object keys", () => {
    expect(isPublicInfoSlug("help")).toBe(true);
    expect(isPublicInfoSlug("rewards")).toBe(false);
    expect(isPublicInfoSlug("toString")).toBe(false);
  });
});
