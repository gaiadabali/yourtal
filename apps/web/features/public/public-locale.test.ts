import { describe, expect, it } from "vitest";
import {
  GENERATED_PUBLIC_LOCALES,
  isPublicLocale,
  publicLanguageAlternates,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
  siteUrl,
} from "./public-locale";

describe("isPublicLocale", () => {
  it("accepts the two known locale segments", () => {
    expect(isPublicLocale("id")).toBe(true);
    expect(isPublicLocale("au")).toBe(true);
  });

  it("rejects anything else, including case variants and empty strings", () => {
    expect(isPublicLocale("ID")).toBe(false);
    expect(isPublicLocale("en-AU")).toBe(false);
    expect(isPublicLocale("")).toBe(false);
    expect(isPublicLocale("fr")).toBe(false);
  });
});

describe("publicLocaleConfig", () => {
  it("maps id to id-ID/IDR and au to en-AU/AUD", () => {
    expect(publicLocaleConfig("id")).toEqual({
      intlLocale: "id-ID",
      currency: "IDR",
      countryName: "Indonesia",
    });
    expect(publicLocaleConfig("au")).toEqual({
      intlLocale: "en-AU",
      currency: "AUD",
      countryName: "Australia",
    });
  });
});

describe("publicUrl", () => {
  it("builds an absolute, locale-prefixed URL", () => {
    expect(publicUrl("id", "/c/abc-123")).toBe("https://yourtal.com/id/c/abc-123");
  });
});

describe("requirePublicLocale", () => {
  it("returns the narrowed locale for a known segment", () => {
    expect(requirePublicLocale("id")).toBe("id");
  });

  it("calls Next's notFound() (throws) for an unknown segment", () => {
    expect(() => requirePublicLocale("fr")).toThrow();
  });
});

describe("GENERATED_PUBLIC_LOCALES", () => {
  // YT-0181: this used to be `["id"]` only — AU had a typed `PublicLocale`
  // value but no generated catalogue, so `/au` 404d despite AU being the
  // primary market (docs/08 §... / TASKS.md's own audit of this gap).
  // `@yourtal/contracts/region/mock` now carries a real AU catalogue, so
  // both locales generate. Asserting the full array, not just its length,
  // so a future locale added to `PUBLIC_LOCALES` without a matching
  // catalogue is caught here rather than discovered as a 404.
  it("pre-renders au first (the primary region), then id", () => {
    expect(GENERATED_PUBLIC_LOCALES).toEqual(["au", "id"]);
  });
});

describe("publicLanguageAlternates", () => {
  // Round-trip on a non-default locale (docs/13 §4: testing only "id", the
  // default, would not catch "au" silently falling back to it).
  it("keys each generated locale's URL by its BCP-47 tag", () => {
    expect(publicLanguageAlternates("/rewards")).toEqual({
      "id-ID": "https://yourtal.com/id/rewards",
      "en-AU": "https://yourtal.com/au/rewards",
    });
  });
});

describe("siteUrl", () => {
  it("defaults to production and keeps only the origin", () => {
    expect(siteUrl(undefined)).toBe("https://yourtal.com");
    expect(siteUrl("")).toBe("https://yourtal.com");
    expect(siteUrl("https://staging.example.test/")).toBe("https://staging.example.test");
    expect(siteUrl("http://127.0.0.1:26357")).toBe("http://127.0.0.1:26357");
  });

  it("refuses a path or a malformed value rather than building broken links", () => {
    expect(() => siteUrl("https://example.test/au")).toThrow(/bare origin/);
    expect(() => siteUrl("not a url")).toThrow();
  });
});
