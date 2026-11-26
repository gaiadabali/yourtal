import { describe, expect, it } from "vitest";
import { DEFAULT_OWN_DOMAINS, isFreemail, isOwnDomain, parseOwnDomains } from "./domains";
import { isDotAtomLocalPart, normalizeDomain, orgDomainOf, splitAddress } from "./org-domain";

describe("orgDomainOf (PSL, ICANN section)", () => {
  it.each([
    ["news.brand.com", "brand.com"],
    ["em.mail.brand.co.uk", "brand.co.uk"],
    ["news.brand.com.au", "brand.com.au"],
    ["promo.toko.co.id", "toko.co.id"],
    ["toko.co.id", "toko.co.id"],
    ["Brand.COM.", "brand.com"],
    ["store.myshopify.com", "myshopify.com"],
    ["xn--bcher-kva.de", "xn--bcher-kva.de"],
    ["mail.bücher.de", "xn--bcher-kva.de"],
    ["spambank.yourtal.gaiada.com", "gaiada.com"],
    ["co.uk", null],
    ["com.au", null],
    ["localhost", null],
    ["203.0.113.9", null],
    ["[203.0.113.9]", null],
    ["a..b.com", null],
    ["-bad.com", null],
    ["under_score.example.com", null],
    ["", null],
  ])("%s → %s", (domain, org) => {
    expect(orgDomainOf(domain)).toBe(org);
  });
});

describe("splitAddress", () => {
  it.each([
    ["News@Brand.COM", { local: "News", domain: "brand.com" }],
    ['"a@b"@brand.com', { local: '"a@b"', domain: "brand.com" }],
    ["no-at-sign", null],
    ["@brand.com", null],
    ["news@", null],
    ["new s@brand.com", null],
    ["news\r\nBcc: x@brand.com", null],
  ])("%s", (email, parts) => {
    expect(splitAddress(email)).toEqual(parts);
  });

  it("refuses an over-long domain", () => {
    expect(normalizeDomain(`${"a".repeat(64)}.com`)).toBeNull();
  });

  it("accepts only dot-atom local parts for an envelope", () => {
    expect(isDotAtomLocalPart("first.last+tag")).toBe(true);
    expect(isDotAtomLocalPart('"quoted"')).toBe(false);
    expect(isDotAtomLocalPart("a..b")).toBe(false);
  });
});

describe("own and freemail domains (§4.6 check 6)", () => {
  const own = parseOwnDomains(undefined);

  it("protects gaiada.com and every subdomain", () => {
    expect(own).toEqual(["gaiada.com", "freetaxreturns.com.au", "yourtal.com"]);
    for (const d of [
      "gaiada.com",
      "yourtal.gaiada.com",
      "spambank.yourtal.gaiada.com",
      "snapapp.gaiada.com",
    ]) {
      expect(isOwnDomain(orgDomainOf(d) ?? "", own)).toBe(true);
    }
    expect(isOwnDomain("brand.com", own)).toBe(false);
  });

  it("only adds to the defaults", () => {
    expect(parseOwnDomains("god.example.com, Other.CO.ID")).toEqual([
      ...DEFAULT_OWN_DOMAINS,
      "example.com",
      "other.co.id",
    ]);
    expect(parseOwnDomains("")).toEqual(DEFAULT_OWN_DOMAINS);
  });

  it("throws on an entry that is not a domain", () => {
    expect(() => parseOwnDomains("gaiada.com, not a domain")).toThrow(/not a domain/);
    expect(() => parseOwnDomains("co.uk")).toThrow(/not a domain/);
  });

  it.each([
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "hotmail.co.uk",
    "live.com",
    "msn.com",
    "yahoo.com",
    "yahoo.co.id",
    "yahoo.com.au",
    "ymail.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "aol.com",
    "proton.me",
    "protonmail.com",
    "gmx.de",
    "gmx.net",
    "mail.com",
    "yandex.ru",
    "zoho.com",
    "bigpond.com",
    "optusnet.com.au",
  ])("%s is freemail", (d) => {
    expect(isFreemail(orgDomainOf(d) ?? "")).toBe(true);
  });

  it.each(["brand.com", "tokopedia.com", "mailchimp.com", "gmailer.com", "zohocorp.com"])(
    "%s is not freemail",
    (d) => {
      expect(isFreemail(d)).toBe(false);
    },
  );
});
