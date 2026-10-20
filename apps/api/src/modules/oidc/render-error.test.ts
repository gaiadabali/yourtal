import { describe, expect, it } from "vitest";
import { errorPage, errorPageLocale, escapeHtml } from "./render-error";

describe("YourTal's sign-in error page", () => {
  it("escapes everything that came from the request", () => {
    const page = errorPage("en-AU", `<script>alert("x")</script>&'`);
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
  });

  it("escapes the five HTML characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("follows the app's ui_locales, then the browser, in English by default", () => {
    expect(errorPageLocale("id-ID en-AU", "en-AU")).toBe("id-ID");
    expect(errorPageLocale(undefined, "id,en;q=0.5")).toBe("id-ID");
    expect(errorPageLocale(undefined, "fr-FR")).toBe("en-AU");
    expect(errorPageLocale(undefined, undefined)).toBe("en-AU");
    expect(errorPage("id-ID", "invalid_client")).toContain('lang="id-ID"');
  });

  it("is a plain page with no links or scripts", () => {
    const page = errorPage("en-AU", "invalid_redirect_uri");
    expect(page).not.toMatch(/<a |<script|<form|http-equiv/i);
    expect(page).toContain("invalid_redirect_uri");
  });
});
