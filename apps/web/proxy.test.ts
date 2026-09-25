import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function requestFor(path: string, cookieHeader = ""): NextRequest {
  // Untyped on purpose: the DOM `RequestInit` and Next's own (imported by
  // `NextRequest`'s constructor overload) disagree on `signal` under
  // `exactOptionalPropertyTypes`, and this object only ever needs `headers`.
  const init = cookieHeader ? { headers: { cookie: cookieHeader } } : {};
  return new NextRequest(new URL(path, "http://127.0.0.1:26343"), init);
}

/**
 * 1.7.c/1.7.e: proxy.ts is a coarse cookie-presence gate. These tests never
 * touch the API — that is exactly the point (the real check happens
 * server-side once 1.5.a lands).
 */
describe("proxy (1.7.c)", () => {
  it.each([
    "/home",
    "/watch",
    "/watch/abc-123",
    "/campaign",
    "/campaign/abc-123",
    "/store",
    "/store/listing-1",
    "/wallet",
    "/wallet/voucher",
    "/me",
    "/onboarding",
    "/onboarding/AU",
    "/quick",
    "/business",
    "/business/billing",
    "/studio",
    "/staff",
  ])("redirects %s to /login?returnTo= without a session", (path) => {
    const response = proxy(requestFor(path));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe(path);
  });

  it("passes a protected prefix through with a yt_session cookie", () => {
    const response = proxy(requestFor("/wallet", "yt_session=abc123"));
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("preserves the query string in returnTo", () => {
    const response = proxy(requestFor("/store?highlight=listing-1"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("returnTo")).toBe("/store?highlight=listing-1");
  });

  it.each(["/id", "/login", "/merchant/pair", "/api/health"])(
    "leaves %s public with no cookies at all",
    (path) => {
      const response = proxy(requestFor(path));
      expect(response.status).not.toBe(307);
    },
  );

  // 3.5.d's route-redirects rule: `/` is the signed-in home, never a login wall.
  it("sends / to /au signed out and to /home signed in", () => {
    const signedOut = proxy(requestFor("/"));
    expect(new URL(signedOut.headers.get("location") ?? "").pathname).toBe("/au");
    const signedIn = proxy(requestFor("/", "yt_session=token"));
    expect(new URL(signedIn.headers.get("location") ?? "").pathname).toBe("/home");
  });

  it("redirects an unpaired /merchant route to /merchant/pair", () => {
    const response = proxy(requestFor("/merchant/devices"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/merchant/pair");
  });

  it("passes a /merchant route with a yt_device cookie", () => {
    const response = proxy(requestFor("/merchant/devices", "yt_device=device-token"));
    expect(response.status).not.toBe(307);
  });

  it("never treats a yt_session cookie as good enough for /merchant (device credential, not a personal session)", () => {
    const response = proxy(requestFor("/merchant/devices", "yt_session=abc123"));
    expect(response.status).toBe(307);
  });
});
