import { describe, expect, it } from "vitest";
import { interactionCookieHeader } from "./connect-cookies";
import { pickConnectLocale } from "./connect-locale";
import { isNavigableRedirect } from "./connect-redirect";
import { connectPath, isInteractionUid } from "./connect-uid";

describe("interactionCookieHeader", () => {
  it("keeps exactly the two interaction cookies, verbatim, and drops everything else", () => {
    const raw =
      "yt_session=secret-token; _interaction=Ab-_9; theme=dark; _interaction.sig=sig%3D%3D; yt_locale=id-ID";
    expect(interactionCookieHeader(raw)).toBe("_interaction=Ab-_9; _interaction.sig=sig%3D%3D");
  });

  it("never forwards the session, whatever its name looks like", () => {
    expect(interactionCookieHeader("yt_session=abc; _interaction_resume=x")).toBeNull();
  });

  it("takes the first of a repeated cookie and ignores malformed pieces", () => {
    expect(interactionCookieHeader("_interaction=one; junk; _interaction=two")).toBe(
      "_interaction=one",
    );
  });

  it("answers null when there is no cookie header at all", () => {
    expect(interactionCookieHeader(null)).toBeNull();
    expect(interactionCookieHeader("")).toBeNull();
  });
});

describe("pickConnectLocale", () => {
  it("follows the app's ui_locales in order", () => {
    expect(pickConnectLocale(["id-ID", "en-AU"], "en-AU")).toBe("id-ID");
    expect(pickConnectLocale(["en-AU", "id-ID"], "id-ID")).toBe("en-AU");
  });

  it("maps a bare language or another region onto the two shipped locales", () => {
    expect(pickConnectLocale(["id"], "en-AU")).toBe("id-ID");
    expect(pickConnectLocale(["en-US"], "id-ID")).toBe("en-AU");
    expect(pickConnectLocale(["fr", "id_ID"], "en-AU")).toBe("id-ID");
  });

  it("uses the person's own language when the app names neither", () => {
    expect(pickConnectLocale([], "id-ID")).toBe("id-ID");
    expect(pickConnectLocale(["fr-FR", "de"], "en-AU")).toBe("en-AU");
  });
});

describe("isNavigableRedirect", () => {
  it("accepts the provider's http(s) routes and nothing else", () => {
    expect(isNavigableRedirect("https://yourtal.gaiada.com/oidc/auth/abc")).toBe(true);
    expect(isNavigableRedirect("http://localhost:26301/oidc/auth/abc")).toBe(true);
    expect(isNavigableRedirect("javascript:alert(1)")).toBe(false);
    expect(isNavigableRedirect("data:text/html,x")).toBe(false);
    expect(isNavigableRedirect("/relative")).toBe(false);
    expect(isNavigableRedirect("https://evil.example/phish")).toBe(false);
    expect(isNavigableRedirect("https://yourtal.gaiada.com/me")).toBe(false);
  });
});

describe("interaction ids", () => {
  it("accepts URL-safe tokens only", () => {
    expect(isInteractionUid("aB3_-xYz0123456789AbC")).toBe(true);
    expect(isInteractionUid("")).toBe(false);
    expect(isInteractionUid("../login")).toBe(false);
    expect(isInteractionUid("a b")).toBe(false);
    expect(isInteractionUid("a".repeat(129))).toBe(false);
  });

  it("builds the path /login and /register return to", () => {
    expect(connectPath("abc")).toBe("/connect/abc");
  });
});
