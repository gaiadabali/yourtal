import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceBinding } from "./device-binding-schema";

/**
 * Same `vi.doMock("next/headers")` + dynamic `import()` pattern as
 * `apps/web/features/region/region-cookie-roundtrip.test.ts` — the only
 * way to exercise a module that value-imports `cookies()` without a real
 * Next.js request context. Each test gets a fresh in-memory cookie jar via
 * `vi.resetModules()` so writes in one test never leak into another.
 */
function createCookieJar() {
  const jar = new Map<string, string>();
  return {
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  };
}

const validBinding: DeviceBinding = {
  deviceId: "device-toko-berkah-1",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  label: "Toko Berkah — Kasir 1",
  locale: "id-ID",
  currency: "IDR",
  countryName: "Indonesia",
  pinHash: "abc123",
  pinSalt: "deadbeef",
  provisionedAt: "2026-09-19T00:00:00.000Z",
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
    jar.set("yourtal-merchant-device", "not-valid-base64url-json-at-all!!");
    expect(await mod.readDeviceBinding()).toBeNull();
  });

  it("returns null for a well-formed but schema-invalid payload", async () => {
    const { mod, jar } = await loadModuleWithFreshCookieJar();
    const malformed = Buffer.from(JSON.stringify({ deviceId: "x" }), "utf8").toString("base64url");
    jar.set("yourtal-merchant-device", malformed);
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
