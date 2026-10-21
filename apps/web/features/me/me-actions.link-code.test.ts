import { afterEach, describe, expect, it, vi } from "vitest";
import { issueLinkCodeAction } from "./me-actions";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/api/session-cookies", () => ({
  clearSessionCookie: vi.fn(),
  setSessionCookies: vi.fn(),
  setThemeCookie: vi.fn(),
}));

afterEach(() => {
  mocks.apiFetch.mockReset();
});

describe("issueLinkCodeAction", () => {
  it("sends an Idempotency-Key, which POST /api/me/linked-apps/code requires", async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { code: "ABCD-1234", expiresAt: "x" } });
    await issueLinkCodeAction();
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    const [path, , init] = mocks.apiFetch.mock.calls[0]!;
    expect(path).toBe("/api/me/linked-apps/code");
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses a fresh key on every click, so each click asks for a new code", async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { code: "ABCD-1234", expiresAt: "x" } });
    await issueLinkCodeAction();
    await issueLinkCodeAction();
    const calls = mocks.apiFetch.mock.calls as [
      string,
      unknown,
      { headers: Record<string, string> },
    ][];
    const keys = calls.map((c) => c[2].headers["idempotency-key"]);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
