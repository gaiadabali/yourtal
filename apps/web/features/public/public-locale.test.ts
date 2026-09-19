import { describe, expect, it } from "vitest";
import {
  GENERATED_PUBLIC_LOCALES,
  isPublicLocale,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
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
  it("only pre-renders id today, per this module's documented scope decision", () => {
    expect(GENERATED_PUBLIC_LOCALES).toEqual(["id"]);
  });
});
