import { describe, expect, it } from "vitest";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";
import { internalReturnPath } from "./return-to";

const ATTACKS = [
  ["a tab", "/\t/evil.com"],
  ["an encoded tab", "/%09/evil.com"],
  ["a line feed", "/\n/evil.com"],
  ["an encoded line feed", "/%0A/evil.com"],
  ["a carriage return", "/\r/evil.com"],
  ["an encoded carriage return", "/%0d/evil.com"],
  ["DEL", "/\u007f/evil.com"],
  ["a backslash", "/\\evil.com"],
  ["an encoded backslash", "/%5Cevil.com"],
  ["a scheme-relative URL", "//evil.com"],
  ["an encoded scheme-relative URL", "/%2F/evil.com"],
  ["an absolute URL", "https://evil.com/"],
  ["an embedded scheme", "/redirect?to=https://evil.com"],
  ["a relative path", "wallet"],
] as const;

describe("returnTo: only a path on this site", () => {
  it.each(ATTACKS)("refuses %s", (_label, value) => {
    expect(internalReturnPath(value)).toBeNull();
    expect(parseReturnTo(value)).toBeNull();
  });

  it.each([
    ["/wallet", "/wallet"],
    ["/watch/abc?from=feed#top", "/watch/abc?from=feed#top"],
    [
      "/wallet/voucher/18e61f63-351e-49c3-9d11-ae63de75a5b5",
      "/wallet/voucher/18e61f63-351e-49c3-9d11-ae63de75a5b5",
    ],
    ["/me/../wallet", "/wallet"],
  ])("keeps %s as %s", (value, expected) => {
    expect(internalReturnPath(value)).toBe(expected);
    expect(parseReturnTo(value)).toBe(expected);
  });

  it("takes the first of repeated parameters, and nothing from undefined", () => {
    expect(parseReturnTo(["/wallet", "//evil.com"])).toBe("/wallet");
    expect(parseReturnTo(undefined)).toBeNull();
  });
});
