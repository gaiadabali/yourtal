import { describe, expect, it } from "vitest";
import { isActiveTab } from "./nav-items";

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

  it("matches the Earn tab on the campaign entry and watch subtrees", () => {
    expect(isActiveTab("/campaign/abc-123", "/", ["/campaign", "/watch"])).toBe(true);
    expect(isActiveTab("/watch/abc-123", "/", ["/campaign", "/watch"])).toBe(true);
    expect(isActiveTab("/watch/abc-123/checkpoint", "/", ["/campaign", "/watch"])).toBe(true);
  });

  it("does not match Earn for other tabs' routes", () => {
    expect(isActiveTab("/quick", "/", ["/campaign", "/watch"])).toBe(false);
    expect(isActiveTab("/store", "/", ["/campaign", "/watch"])).toBe(false);
  });

  it("matches Earn's root path exactly, not every path", () => {
    expect(isActiveTab("/", "/", ["/campaign", "/watch"])).toBe(true);
    expect(isActiveTab("/me", "/", ["/campaign", "/watch"])).toBe(false);
  });
});
