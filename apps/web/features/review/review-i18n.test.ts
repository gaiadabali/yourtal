import { describe, expect, it } from "vitest";
import { getReviewTranslator, reviewLocaleFromParam } from "./review-i18n";

describe("the reviewer's guide language (V1)", () => {
  it("reads ?lang= and leaves anything else to the viewer's own language", () => {
    expect(reviewLocaleFromParam("id")).toBe("id-ID");
    expect(reviewLocaleFromParam(["en", "id"])).toBe("en-AU");
    expect(reviewLocaleFromParam("fr")).toBeUndefined();
    expect(reviewLocaleFromParam(undefined)).toBeUndefined();
  });

  it("has the guide in both languages, with the demo counter's pin filled in", () => {
    const en = getReviewTranslator("en-AU");
    const id = getReviewTranslator("id-ID");
    expect(en("title")).toBe("Review YourTal");
    expect(id("title")).toBe("Tinjau YourTal");
    expect(id("logins.counter", { pairUrl: "/merchant/pair", pin: "2468" })).toContain("2468");
  });
});
