import { describe, expect, it } from "vitest";
import { isAppSignUpReturn } from "./onboarding-return-to";

describe("isAppSignUpReturn", () => {
  it("is true for an interaction's /connect/<uid> path", () => {
    expect(isAppSignUpReturn("/connect/abc_DEF-123")).toBe(true);
  });

  it.each([
    null,
    "/",
    "/watch/campaign-1",
    "/onboarding?returnTo=%2Fconnect%2Fabc",
    "/connect",
    "/connect/",
    "/connect/abc/extra",
    "/connect/abc?x=1",
    "/connect/a%2Fb",
  ])("is false for %s", (value) => {
    expect(isAppSignUpReturn(value)).toBe(false);
  });
});
