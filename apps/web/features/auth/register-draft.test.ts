import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGISTER_DRAFT_COOKIE } from "./register-draft";

class RedirectSignal extends Error {}

const jar = new Map<string, string>();
const apiFetch = vi.fn();

async function submit(): Promise<void> {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    redirect: () => {
      throw new RedirectSignal();
    },
  }));
  vi.doMock("next/headers", () => ({
    cookies: () =>
      Promise.resolve({
        set: (name: string, value: string) => void jar.set(name, value),
        delete: ({ name }: { name: string }) => void jar.delete(name),
      }),
  }));
  vi.doMock("@/lib/api/api-fetch", () => ({ apiFetch }));
  vi.doMock("@/lib/api/session-cookies", () => ({
    setSessionCookies: vi.fn(),
    setMfaPendingCookie: vi.fn(),
  }));
  const { registerAction } = await import("./auth-actions");
  const data = new FormData();
  data.set("email", "kid@example.test");
  data.set("password", "a-long-password-1");
  data.set("dateOfBirth", "2011-06-01");
  await registerAction(data).catch((e: unknown) => {
    if (!(e instanceof RedirectSignal)) throw e;
  });
}

const refusal = (code: string) => ({ ok: false, error: { kind: "http", code } });

describe("register draft cookie", () => {
  beforeEach(() => {
    jar.clear();
    apiFetch.mockReset();
  });

  it("is kept, without the password, only after guardian_email_required", async () => {
    apiFetch.mockResolvedValueOnce(refusal("guardian_email_required"));
    await submit();
    const saved = jar.get(REGISTER_DRAFT_COOKIE) ?? "";
    expect(saved).toContain("kid@example.test");
    expect(saved).not.toContain("a-long-password-1");
  });

  it.each(["too_young", "below_minimum_age", "email_taken"])(
    "is deleted after %s, so a refused date of birth is never prefilled",
    async (code) => {
      jar.set(REGISTER_DRAFT_COOKIE, "{}");
      apiFetch.mockResolvedValueOnce(refusal(code));
      await submit();
      expect(jar.has(REGISTER_DRAFT_COOKIE)).toBe(false);
    },
  );

  it("is deleted on a successful sign-up", async () => {
    jar.set(REGISTER_DRAFT_COOKIE, "{}");
    apiFetch
      .mockResolvedValueOnce({ ok: true, data: { token: "t" } })
      .mockResolvedValueOnce(refusal("network"));
    await submit();
    expect(jar.has(REGISTER_DRAFT_COOKIE)).toBe(false);
  });
});
