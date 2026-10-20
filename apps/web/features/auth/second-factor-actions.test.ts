import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Same harness as `lib/api/actions.test.ts`: `redirect()` throws, cookies are a Map. */
class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

const ME = {
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
};

async function load(jar: Map<string, string>) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  }));
  vi.doMock("next/headers", () => ({
    cookies: () =>
      Promise.resolve({
        get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
        set: (name: string, value: string) => void jar.set(name, value),
        delete: (name: string) => void jar.delete(name),
      }),
  }));
  return import("./second-factor-actions");
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("second-factor Server Actions (3.9c)", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env["API_INTERNAL_URL"];
  let calls: string[];

  /** `signIn` is what the code/passkey endpoint answers; `/me` and the rest answer as a signed-in account. */
  function mockApi(signIn: { status: number; body: unknown }) {
    calls = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      calls.push(url);
      const reply = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (url.endsWith("/totp/sign-in") || url.endsWith("/passkeys/sign-in")) {
        return reply(signIn.body, signIn.status);
      }
      if (url.endsWith("/api/me")) return reply(ME);
      if (url.endsWith("/api/auth/sign-in-methods")) {
        return reply({
          password: true,
          passkeys: [{ id: "p" }],
          authenticatorApp: { enabled: true },
        });
      }
      return reply({ code: "not_found", message: url }, 404);
    });
  }

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

  describe("totpSignInAction", () => {
    it("sends the person back to /login when the pending cookie is gone, without calling the API", async () => {
      mockApi({ status: 200, body: {} });
      const { totpSignInAction } = await load(new Map());

      const url = await redirectOf(totpSignInAction(form({ code: "123456", returnTo: "/wallet" })));

      expect(url).toBe("/login?error=second_step_expired&returnTo=%2Fwallet");
      expect(calls).toHaveLength(0);
    });

    it("rejects a malformed code locally, so it costs no attempt", async () => {
      mockApi({ status: 200, body: {} });
      const { totpSignInAction } = await load(new Map([["yt_mfa_pending", "pending-1"]]));

      const url = await redirectOf(totpSignInAction(form({ code: "12ab" })));

      expect(url).toBe("/login/code?error=factor_invalid");
      expect(calls).toHaveLength(0);
    });

    it("goes back to the code page with the API's error code on a wrong code", async () => {
      mockApi({ status: 401, body: { code: "factor_invalid", message: "no" } });
      const jar = new Map([["yt_mfa_pending", "pending-1"]]);
      const { totpSignInAction } = await load(jar);

      const url = await redirectOf(
        totpSignInAction(form({ code: "123 456", returnTo: "/wallet" })),
      );

      expect(url).toBe("/login/code?error=factor_invalid&returnTo=%2Fwallet");
      expect(jar.has("yt_session")).toBe(false);
      expect(jar.get("yt_mfa_pending")).toBe("pending-1");
    });

    it("signs in on a right code, clears the pending cookie and continues to returnTo", async () => {
      mockApi({ status: 200, body: { token: "tok-2", userId: "user-1" } });
      const jar = new Map([
        ["yt_mfa_pending", "pending-1"],
        ["yt_passkey_prompt", "seen"],
      ]);
      const { totpSignInAction } = await load(jar);

      const url = await redirectOf(
        totpSignInAction(form({ code: "123 456", returnTo: "/wallet" })),
      );

      expect(url).toBe("/wallet");
      expect(jar.get("yt_session")).toBe("tok-2");
      expect(jar.has("yt_mfa_pending")).toBe(false);
    });

    it("ignores an external returnTo", async () => {
      mockApi({ status: 200, body: { token: "tok-2", userId: "user-1" } });
      const jar = new Map([
        ["yt_mfa_pending", "pending-1"],
        ["yt_passkey_prompt", "seen"],
      ]);
      const { totpSignInAction } = await load(jar);

      const url = await redirectOf(
        totpSignInAction(form({ code: "123456", returnTo: "//evil.example" })),
      );

      expect(url).toBe("/");
    });
  });

  describe("passkeySignInAction", () => {
    it("returns the API's code, and sets no session, when the passkey is refused", async () => {
      mockApi({ status: 401, body: { code: "factor_invalid", message: "no" } });
      const jar = new Map<string, string>();
      const { passkeySignInAction } = await load(jar);

      const result = await passkeySignInAction("chal-1", { id: "cred-1" }, "/wallet");

      expect(result).toEqual({ ok: false, code: "factor_invalid" });
      expect(jar.has("yt_session")).toBe(false);
    });

    it("signs in and goes to returnTo, with no passkey offer", async () => {
      mockApi({ status: 200, body: { token: "tok-3", userId: "user-1" } });
      const jar = new Map<string, string>();
      const { passkeySignInAction } = await load(jar);

      const url = await redirectOf(passkeySignInAction("chal-1", { id: "cred-1" }, "/wallet"));

      expect(url).toBe("/wallet");
      expect(jar.get("yt_session")).toBe("tok-3");
      expect(calls.some((call) => call.endsWith("/sign-in-methods"))).toBe(false);
    });
  });
});
