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

  it("matches the Home tab on the campaign entry and watch subtrees", () => {
    expect(isActiveTab("/campaign/abc-123", "/home", ["/campaign", "/watch"])).toBe(true);
    expect(isActiveTab("/watch/abc-123", "/home", ["/campaign", "/watch"])).toBe(true);
    expect(isActiveTab("/watch/abc-123/checkpoint", "/home", ["/campaign", "/watch"])).toBe(true);
  });

  it("does not match Home for other tabs' routes", () => {
    expect(isActiveTab("/quick", "/home", ["/campaign", "/watch"])).toBe(false);
    expect(isActiveTab("/store", "/home", ["/campaign", "/watch"])).toBe(false);
  });

  it("matches Home's root path exactly, not every path", () => {
    expect(isActiveTab("/home", "/home", ["/campaign", "/watch"])).toBe(true);
    expect(isActiveTab("/me", "/home", ["/campaign", "/watch"])).toBe(false);
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
      "/quick",
      "/store",
      "/wallet",
      "/me",
    ]);
  });

  it("keeps no link to /business anywhere in the tab list (requested by C)", () => {
    expect(navItems.some((item) => item.href.startsWith("/business"))).toBe(false);
  });
});
