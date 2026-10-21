import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The connect Server Actions and the details loader read `next/headers`
 * (the browser's cookies) and call the API with `fetch`. Both are faked here
 * so the test can assert on exactly what leaves the web server.
 */
const BROWSER_COOKIES =
  "yt_session=session-token; yt_locale=en-AU; _interaction=uid_123-abc; _interaction.sig=sig-value; analytics=1";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

async function load(jar: Map<string, string>) {
  vi.resetModules();
  vi.doMock("next/headers", () => ({
    headers: () => Promise.resolve(new Headers({ cookie: BROWSER_COOKIES })),
    cookies: () =>
      Promise.resolve({
        get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
        delete: (name: string) => {
          jar.delete(name);
        },
        set: (name: string, value: string) => {
          jar.set(name, value);
        },
      }),
  }));
  const actions = await import("./connect-actions");
  const api = await import("./connect-api");
  return { ...actions, ...api };
}

function mockApi(respond: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  });
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const DETAILS = {
  uid: "uid_123-abc",
  screen: "consent",
  client: {
    clientId: "snapapp-web",
    name: "SnapApp",
    operator: "SnapApp",
    externalOperator: false,
    privacyUrl: "https://snap-apps.gaiada.com/privacy",
    termsUrl: "https://snap-apps.gaiada.com/terms",
    returnHost: "snap-apps.gaiada.com",
  },
  account: { name: "Ana", email: "ana@example.com" },
  sharing: { claims: ["name", "email"], ageBand: "adult", region: "AU" },
  refusal: null,
  uiLocales: ["id-ID"],
};

describe("connect Server Actions and loader", () => {
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
  });

  describe("loadInteraction", () => {
    it("forwards exactly the two interaction cookies plus the session, and returns the details", async () => {
      const calls = mockApi(() => json(200, DETAILS));
      const { loadInteraction } = await load(new Map([["yt_session", "session-token"]]));

      const result = await loadInteraction("uid_123-abc");

      expect(result).toEqual({ kind: "ok", details: DETAILS });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("http://127.0.0.1:26344/api/connect/uid_123-abc");
      expect(calls[0]?.method).toBe("GET");
      expect(calls[0]?.headers.get("cookie")).toBe(
        "_interaction=uid_123-abc; _interaction.sig=sig-value",
      );
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer session-token");
    });

    it("sends no session when the person is signed out", async () => {
      const calls = mockApi(() =>
        json(200, { ...DETAILS, screen: "login", account: null, sharing: null }),
      );
      const { loadInteraction } = await load(new Map());

      await loadInteraction("uid_123-abc");

      expect(calls[0]?.headers.has("authorization")).toBe(false);
      expect(calls[0]?.headers.get("cookie")).toBe(
        "_interaction=uid_123-abc; _interaction.sig=sig-value",
      );
    });

    it("answers `ended` for a 404 and `unavailable` for anything else", async () => {
      mockApi(() => json(404, { code: "interaction_not_found", message: "gone" }));
      const first = await load(new Map());
      expect(await first.loadInteraction("uid_123-abc")).toEqual({ kind: "ended" });

      mockApi(() => json(500, { message: "boom" }));
      const second = await load(new Map());
      expect(await second.loadInteraction("uid_123-abc")).toEqual({ kind: "unavailable" });

      mockApi(() => json(200, { nonsense: true }));
      const third = await load(new Map());
      expect(await third.loadInteraction("uid_123-abc")).toEqual({ kind: "unavailable" });
    });
  });

  describe("consentContinueAction and oneTapContinueAction", () => {
    it("posts JSON with the screen, forwards the cookies and session, and returns redirectTo", async () => {
      const calls = mockApi(() =>
        json(200, { redirectTo: "https://yourtal.test/oidc/auth/abc/resume" }),
      );
      const { consentContinueAction } = await load(new Map([["yt_session", "session-token"]]));

      const result = await consentContinueAction("uid_123-abc");

      expect(result).toEqual({
        kind: "redirect",
        redirectTo: "https://yourtal.test/oidc/auth/abc/resume",
      });
      expect(calls[0]?.url).toBe("http://127.0.0.1:26344/api/connect/uid_123-abc/continue");
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.headers.get("content-type")).toBe("application/json");
      expect(calls[0]?.body).toEqual({ screen: "consent" });
      expect(calls[0]?.headers.get("cookie")).toBe(
        "_interaction=uid_123-abc; _interaction.sig=sig-value",
      );
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer session-token");
      // Nothing but the two interaction cookies and the session leaves the server.
      expect(calls[0]?.headers.get("cookie")).not.toContain("analytics");
      expect(calls[0]?.headers.get("cookie")).not.toContain("yt_");
    });

    it("each action fixes its own screen; the browser supplies only the id", async () => {
      const calls = mockApi(() => json(200, { redirectTo: "https://yourtal.test/x" }));
      const { oneTapContinueAction, consentContinueAction } = await load(new Map());
      await oneTapContinueAction("uid_123-abc");
      await consentContinueAction("uid_123-abc");
      expect(calls[0]?.body).toEqual({ screen: "continue" });
      expect(calls[1]?.body).toEqual({ screen: "consent" });
      expect(consentContinueAction.length).toBe(1);
      expect(oneTapContinueAction.length).toBe(1);
    });

    it("409 screen_changed reloads the details", async () => {
      mockApi(() => json(409, { code: "screen_changed", message: "reload" }));
      const { oneTapContinueAction } = await load(new Map());
      expect(await oneTapContinueAction("uid_123-abc")).toEqual({ kind: "reload" });
    });

    it("404 reloads, so the page shows the ended screen", async () => {
      mockApi(() => json(404, { code: "interaction_not_found", message: "gone" }));
      const { consentContinueAction } = await load(new Map());
      expect(await consentContinueAction("uid_123-abc")).toEqual({ kind: "reload" });
    });

    it("403 sign_in_refused and 401 session_required reload to the refusal and the sign-in", async () => {
      mockApi(() => json(403, { code: "sign_in_refused", refusal: "teen_not_allowed" }));
      const refused = await load(new Map());
      expect(await refused.consentContinueAction("uid_123-abc")).toEqual({ kind: "reload" });

      mockApi(() => json(401, { code: "session_required", message: "sign in" }));
      const unauthenticated = await load(new Map());
      expect(await unauthenticated.consentContinueAction("uid_123-abc")).toEqual({
        kind: "reload",
      });
    });

    it("a server error or an unreachable API is a plain error", async () => {
      mockApi(() => json(500, { message: "boom" }));
      const down = await load(new Map());
      expect(await down.consentContinueAction("uid_123-abc")).toEqual({ kind: "error" });

      global.fetch = vi.fn(() => Promise.reject(new Error("offline")));
      const offline = await load(new Map());
      expect(await offline.consentContinueAction("uid_123-abc")).toEqual({ kind: "error" });
    });

    it("refuses a redirect that is not http(s), and arguments that are not ours, without calling the API", async () => {
      const calls = mockApi(() => json(200, { redirectTo: "https://yourtal.test/x" }));
      const { consentContinueAction } = await load(new Map());
      expect(await consentContinueAction("../etc")).toEqual({ kind: "error" });
      expect(calls).toHaveLength(0);

      // The contract's z.url() accepts any scheme; the action does not follow a non-web one.
      mockApi(() => json(200, { redirectTo: "javascript:alert(1)" }));
      const bad = await load(new Map());
      expect(await bad.consentContinueAction("uid_123-abc")).toEqual({ kind: "error" });
    });
  });

  describe("cancelAction", () => {
    it("posts an empty JSON object with the same cookies and returns redirectTo", async () => {
      const calls = mockApi(() =>
        json(200, { redirectTo: "https://yourtal.test/oidc/auth/abc/resume" }),
      );
      const { cancelAction } = await load(new Map([["yt_session", "session-token"]]));

      const result = await cancelAction("uid_123-abc");

      expect(result).toEqual({
        kind: "redirect",
        redirectTo: "https://yourtal.test/oidc/auth/abc/resume",
      });
      expect(calls[0]?.url).toBe("http://127.0.0.1:26344/api/connect/uid_123-abc/cancel");
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.body).toEqual({});
      expect(calls[0]?.headers.get("content-type")).toBe("application/json");
      expect(calls[0]?.headers.get("cookie")).toBe(
        "_interaction=uid_123-abc; _interaction.sig=sig-value",
      );
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer session-token");
    });

    it("404 reloads to the ended page", async () => {
      mockApi(() => json(404, { code: "interaction_not_found", message: "gone" }));
      const { cancelAction } = await load(new Map());
      expect(await cancelAction("uid_123-abc")).toEqual({ kind: "reload" });
    });
  });

  describe("switchAccountAction", () => {
    it("ends the session, clears the cookie even if the API call fails, and reloads", async () => {
      const calls = mockApi(() => json(500, { message: "boom" }));
      const jar = new Map([["yt_session", "session-token"]]);
      const { switchAccountAction } = await load(jar);

      expect(await switchAccountAction()).toEqual({ kind: "reload" });

      expect(calls[0]?.url).toBe("http://127.0.0.1:26344/api/auth/logout");
      expect(calls[0]?.method).toBe("POST");
      expect(jar.has("yt_session")).toBe(false);
    });
  });

  describe("resendVerificationAction", () => {
    it("asks the API for another link with the session", async () => {
      const calls = mockApi(() => json(201, { requested: true }));
      const { resendVerificationAction } = await load(new Map([["yt_session", "session-token"]]));

      expect(await resendVerificationAction()).toEqual({ kind: "sent" });
      expect(calls[0]?.url).toBe("http://127.0.0.1:26344/api/auth/email/verify/request");
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer session-token");
    });

    it("maps 429 to throttled and 401 to a reload", async () => {
      mockApi(() => json(429, { code: "throttled", message: "slow down" }));
      const throttled = await load(new Map());
      expect(await throttled.resendVerificationAction()).toEqual({ kind: "throttled" });

      mockApi(() => json(401, { code: "unauthorized", message: "no" }));
      const signedOut = await load(new Map());
      expect(await signedOut.resendVerificationAction()).toEqual({ kind: "reload" });
    });
  });
});
