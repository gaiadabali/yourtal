import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `actions.ts` value-imports `next/headers` (via `session-cookies.ts`) and
 * calls `next/navigation`'s `redirect`, neither of which exist outside a
 * real Next.js request — same `vi.doMock` + dynamic `import()` pattern as
 * `region-cookie-roundtrip.test.ts` and `device-session-cookie.test.ts`.
 * `redirect()` itself is modelled as throwing (as it really does — Next
 * implements it as a thrown control-flow signal), carrying the URL it was
 * given, so a test can assert on it with `.rejects.toThrow`.
 */
class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

function mockNavigation() {
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  }));
}

function createCookieJar() {
  const jar = new Map<string, string>();
  return {
    jar,
    api: {
      get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
      set: (name: string, value: string) => {
        jar.set(name, value);
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    },
  };
}

async function loadActions(cookieApi: ReturnType<typeof createCookieJar>["api"]) {
  vi.resetModules();
  mockNavigation();
  vi.doMock("next/headers", () => ({ cookies: () => Promise.resolve(cookieApi) }));
  return import("./actions");
}

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function expectRedirectTo(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("expected the action to redirect");
}

/** `input` is `RequestInfo | URL`; `String(input)` on a plain `Request` would stringify to `[object Request]`. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("identity Server Actions (1.7.b)", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env["API_INTERNAL_URL"];

  beforeEach(() => {
    process.env["API_INTERNAL_URL"] = "http://127.0.0.1:26344";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env["API_INTERNAL_URL"];
    else process.env["API_INTERNAL_URL"] = originalEnv;
    vi.doUnmock("next/headers");
    vi.doUnmock("next/navigation");
  });

  describe("loginAction", () => {
    it("sets yt_session, yt_region and yt_locale from the account's own profile, then redirects to returnTo", async () => {
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/auth/login")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "tok-1", userId: "user-1" }), { status: 200 }),
          );
        }
        if (url.endsWith("/api/me")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                profile: {
                  userId: "user-1",
                  region: "AU",
                  displayLocale: "en-AU",
                  displayName: "Ada",
                  ageBand: "adult",
                  timezone: "Australia/Sydney",
                },
                businessMemberships: [],
                staffRoles: [],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.reject(new Error(`unexpected fetch to ${url}`));
      });

      const { jar, api } = createCookieJar();
      const { loginAction } = await loadActions(api);

      const url = await expectRedirectTo(
        loginAction(
          formData({ email: "ada@example.com", password: "hunter2", returnTo: "/wallet" }),
        ),
      );

      expect(url).toBe("/wallet");
      expect(jar.get("yt_session")).toBe("tok-1");
      expect(jar.get("yt_region")).toBe("AU");
      expect(jar.get("yt_locale")).toBe("en-AU");
    });

    it("redirects to /login?error=missing_credentials without calling the API at all", async () => {
      const fetchMock = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
      global.fetch = fetchMock;
      const { api } = createCookieJar();
      const { loginAction } = await loadActions(api);

      const url = await expectRedirectTo(loginAction(formData({ email: "", password: "" })));

      expect(url).toBe("/login?error=missing_credentials");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("redirects to /login with the API's own error code on wrong credentials, keeping returnTo", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: "invalid_credentials", message: "nope" }), {
            status: 401,
          }),
        ),
      );
      const { jar, api } = createCookieJar();
      const { loginAction } = await loadActions(api);

      const url = await expectRedirectTo(
        loginAction(formData({ email: "a@example.com", password: "wrong", returnTo: "/wallet" })),
      );

      expect(url).toBe("/login?error=invalid_credentials&returnTo=%2Fwallet");
      expect(jar.has("yt_session")).toBe(false);
    });

    it("does not set any cookie if GET /api/me fails right after a successful login", async () => {
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/auth/login")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "tok-1", userId: "user-1" }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ code: "internal", message: "boom" }), { status: 500 }),
        );
      });
      const { jar, api } = createCookieJar();
      const { loginAction } = await loadActions(api);

      const url = await expectRedirectTo(
        loginAction(formData({ email: "a@example.com", password: "x" })),
      );

      expect(url).toBe("/login?error=profile_unavailable");
      expect(jar.has("yt_session")).toBe(false);
    });
  });

  describe("logoutAction", () => {
    it("clears yt_session and redirects to /login even if the API call fails", async () => {
      global.fetch = vi.fn(() => Promise.resolve(new Response("", { status: 500 })));
      const { jar, api } = createCookieJar();
      jar.set("yt_session", "tok-1");
      const { logoutAction } = await loadActions(api);

      const url = await expectRedirectTo(logoutAction());

      expect(url).toBe("/login");
      expect(jar.has("yt_session")).toBe(false);
    });
  });

  describe("updateMeAction", () => {
    it("refreshes yt_locale from the response and redirects to returnTo", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              profile: {
                userId: "user-1",
                region: "AU",
                displayLocale: "id-ID",
                displayName: "Ada",
                ageBand: "adult",
                timezone: "Australia/Sydney",
              },
              businessMemberships: [],
              staffRoles: [],
            }),
            { status: 200 },
          ),
        ),
      );
      const { jar, api } = createCookieJar();
      jar.set("yt_session", "tok-1");
      const { updateMeAction } = await loadActions(api);

      const url = await expectRedirectTo(
        updateMeAction(formData({ displayLocale: "id-ID", returnTo: "/me" })),
      );

      expect(url).toBe("/me");
      expect(jar.get("yt_locale")).toBe("id-ID");
    });

    it("redirects back to returnTo with an error code on failure, without touching the cookie", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: "profile_not_found", message: "no" }), {
            status: 404,
          }),
        ),
      );
      const { jar, api } = createCookieJar();
      jar.set("yt_session", "tok-1");
      jar.set("yt_locale", "en-AU");
      const { updateMeAction } = await loadActions(api);

      const url = await expectRedirectTo(updateMeAction(formData({ displayName: "New Name" })));

      expect(url).toBe("/me?error=profile_not_found");
      expect(jar.get("yt_locale")).toBe("en-AU");
    });
  });
});
