import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `revokedDeviceIds` (see `provisioning-data.ts`'s file comment on why it
 * is a plain in-process `Set`) is module-scope state, so each test resets
 * the module registry first to start from a clean registry — same
 * isolation concern as `device-session-cookie.test.ts`'s fresh cookie jar
 * per test.
 */
async function freshModule() {
  vi.resetModules();
  return import("./provisioning-data");
}

describe("provisioning-data", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves a known provisioning code to its bound merchant and location", async () => {
    const { resolveProvisioningCode } = await freshModule();
    const template = await resolveProvisioningCode("TOKO-BERKAH-1");
    expect(template).toEqual({
      merchantId: "00000000-0000-4000-8000-000000000601",
      merchantName: "Toko Berkah",
      label: "Toko Berkah — Kasir 1",
      locale: "id-ID",
      currency: "IDR",
      countryName: "Indonesia",
    });
  });

  it("is case- and whitespace-insensitive", async () => {
    const { resolveProvisioningCode } = await freshModule();
    expect(await resolveProvisioningCode("  toko-berkah-1  ")).not.toBeNull();
  });

  it("returns null for an unrecognised code", async () => {
    const { resolveProvisioningCode } = await freshModule();
    expect(await resolveProvisioningCode("NOT-A-REAL-CODE")).toBeNull();
  });

  it("resolves a different code to a different merchant, never the same binding", async () => {
    const { resolveProvisioningCode } = await freshModule();
    const a = await resolveProvisioningCode("TOKO-BERKAH-1");
    const b = await resolveProvisioningCode("SYDNEY-CBD-1");
    expect(a?.merchantId).not.toBe(b?.merchantId);
    expect(b?.currency).toBe("AUD");
  });

  it("a device is not revoked until revokeDevice is called for it", async () => {
    const { isDeviceRevoked } = await freshModule();
    expect(await isDeviceRevoked("device-never-revoked")).toBe(false);
  });

  it("revokeDevice takes effect immediately for that device id, within this process", async () => {
    const { isDeviceRevoked, revokeDevice } = await freshModule();
    await revokeDevice("device-under-test");
    expect(await isDeviceRevoked("device-under-test")).toBe(true);
    expect(await isDeviceRevoked("some-other-device")).toBe(false);
  });

  it("listOtherKnownDevices reflects a revocation made against one of its rows", async () => {
    const { listOtherKnownDevices, revokeDevice } = await freshModule();
    const before = await listOtherKnownDevices();
    expect(before.every((device) => !device.revoked)).toBe(true);

    await revokeDevice("counter-kemang-2");
    const after = await listOtherKnownDevices();
    const kemang = after.find((device) => device.deviceId === "counter-kemang-2");
    expect(kemang?.revoked).toBe(true);
    expect(
      after
        .filter((device) => device.deviceId !== "counter-kemang-2")
        .every((device) => !device.revoked),
    ).toBe(true);
  });
});
