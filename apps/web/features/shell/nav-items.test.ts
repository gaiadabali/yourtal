import { describe, expect, it } from "vitest";
import { isActiveTab, navItems } from "./nav-items";

describe("isActiveTab", () => {
  it("matches the tab's own exact path", () => {
    expect(isActiveTab("/wallet", "/wallet")).toBe(true);
  });

  it("matches a subroute of the tab's own path", () => {
    expect(isActiveTab("/wallet/history", "/wallet")).toBe(true);
  });

  it("does not match a different path that merely shares a prefix string", () => {
    expect(isActiveTab("/walletx", "/wallet")).toBe(false);
  });

  it("matches the Home tab on the campaign entry subtree", () => {
    expect(isActiveTab("/campaign/abc-123", "/home", ["/campaign"])).toBe(true);
  });

  it("does not match Home for other tabs' routes, including Watch's own campaign pages", () => {
    expect(isActiveTab("/watch", "/home", ["/campaign"])).toBe(false);
    expect(isActiveTab("/watch/abc-123", "/home", ["/campaign"])).toBe(false);
    expect(isActiveTab("/store", "/home", ["/campaign"])).toBe(false);
  });

  it("matches Home's root path exactly, not every path", () => {
    expect(isActiveTab("/home", "/home", ["/campaign"])).toBe(true);
    expect(isActiveTab("/me", "/home", ["/campaign"])).toBe(false);
  });

  it("matches the Watch tab on its own campaign-page subtree (11.7.d)", () => {
    expect(isActiveTab("/watch", "/watch")).toBe(true);
    expect(isActiveTab("/watch/abc-123", "/watch")).toBe(true);
    expect(isActiveTab("/watch/abc-123/checkpoint", "/watch")).toBe(true);
  });
});

describe("navItems", () => {
  it("lists the five tabs in the fixed Home · Watch · Store · Wallet · Me order (task 3.5.c)", () => {
    expect(navItems.map((item) => item.labelKey)).toStrictEqual([
      "home",
      "watch",
      "store",
      "wallet",
      "me",
    ]);
    expect(navItems.map((item) => item.href)).toStrictEqual([
      "/home",
      "/watch",
      "/store",
      "/wallet",
      "/me",
    ]);
  });

  it("has no overlap between any two tabs' own match prefixes (11.7.d: Home and Watch used to both claim /watch)", () => {
    for (const item of navItems) {
      for (const other of navItems) {
        if (item === other) continue;
        const otherPrefixes = [other.href, ...(other.matchPrefixes ?? [])];
        expect(otherPrefixes).not.toContain(item.href);
      }
    }
  });

  it("keeps no link to /business anywhere in the tab list (requested by C)", () => {
    expect(navItems.some((item) => item.href.startsWith("/business"))).toBe(false);
  });
});
