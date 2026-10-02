import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceBinding } from "./device-binding-schema";

/**
 * Same `vi.doMock("next/headers")` + dynamic `import()` pattern as
 * `apps/web/features/region/region-cookie-roundtrip.test.ts` — the only
 * way to exercise a module that value-imports `cookies()` without a real
 * Next.js request context. Each test gets a fresh in-memory cookie jar via
 * `vi.resetModules()` so writes in one test never leak into another.
 */
/**
 * Path-aware, like a browser (13.3.b): a delete only removes the cookie set
 * at the same path, so a `/merchant` cookie survived a path-less delete and
 * "Lock now" never locked.
 */
function createCookieJar() {
  const jar = new Map<string, string>();
  const key = (name: string, path = "/") => `${path}|${name}`;
  return {
    get: (name: string) => {
      const value = jar.get(key(name, "/merchant")) ?? jar.get(key(name));
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string, options?: { path?: string }) => {
      jar.set(key(name, options?.path), value);
    },
    delete: (target: string | { name: string; path?: string }) => {
      if (typeof target === "string") jar.delete(key(target));
      else jar.delete(key(target.name, target.path));
    },
  };
}

const validBinding: DeviceBinding = {
  deviceId: "3f9a2b10-1111-4000-8000-000000000001",
  credential: "dc_live_abcdef1234567890",
  pairedAt: "2026-09-19T00:00:00.000Z",
};

async function loadModuleWithFreshCookieJar() {
  vi.resetModules();
  const jar = createCookieJar();
  vi.doMock("next/headers", () => ({ cookies: () => Promise.resolve(jar) }));
  const mod = await import("./device-session-cookie");
  return { mod, jar };
}

describe("device-session-cookie", () => {
  beforeEach(() => {
    vi.doUnmock("next/headers");
  });

  it("round-trips a written device binding", async () => {
    const { mod } = await loadModuleWithFreshCookieJar();
    await mod.writeDeviceBinding(validBinding);
    expect(await mod.readDeviceBinding()).toEqual(validBinding);
  });

  it("returns null when no device has ever been paired", async () => {
    const { mod } = await loadModuleWithFreshCookieJar();
    expect(await mod.readDeviceBinding()).toBeNull();
  });

  it("returns null (never throws) for a corrupt cookie value", async () => {
    const { mod, jar } = await loadModuleWithFreshCookieJar();
    jar.set("yt_device", "not-valid-base64url-json-at-all!!");
    expect(await mod.readDeviceBinding()).toBeNull();
  });

  it("returns null for a well-formed but schema-invalid payload (D16: a hand-made cookie value grants nothing)", async () => {
    const { mod, jar } = await loadModuleWithFreshCookieJar();
    const malformed = Buffer.from(JSON.stringify({ deviceId: "x" }), "utf8").toString("base64url");
    jar.set("yt_device", malformed);
    expect(await mod.readDeviceBinding()).toBeNull();
  });

  it("clearDeviceBinding removes both the device and unlock cookies", async () => {
    const { mod } = await loadModuleWithFreshCookieJar();
    await mod.writeDeviceBinding(validBinding);
    await mod.markUnlocked();
    expect(await mod.isDeviceUnlocked()).toBe(true);

    await mod.clearDeviceBinding();
    expect(await mod.readDeviceBinding()).toBeNull();
    expect(await mod.isDeviceUnlocked()).toBe(false);
  });

  it("markLocked reverses markUnlocked without touching the device binding", async () => {
    const { mod } = await loadModuleWithFreshCookieJar();
    await mod.writeDeviceBinding(validBinding);
    await mod.markUnlocked();
    expect(await mod.isDeviceUnlocked()).toBe(true);

    await mod.markLocked();
    expect(await mod.isDeviceUnlocked()).toBe(false);
    expect(await mod.readDeviceBinding()).toEqual(validBinding);
  });

  it("a fresh, never-unlocked device reports locked", async () => {
    const { mod } = await loadModuleWithFreshCookieJar();
    await mod.writeDeviceBinding(validBinding);
    expect(await mod.isDeviceUnlocked()).toBe(false);
  });
});
