import { beforeEach, describe, expect, it, vi } from "vitest";

type AnyFn = (...args: unknown[]) => unknown;
const apiFetch = vi.fn<AnyFn>();
const writeDeviceBinding = vi.fn<AnyFn>();
const markUnlocked = vi.fn<AnyFn>();
const readDeviceBinding = vi.fn<AnyFn>();

vi.mock("@/lib/api/api-fetch", () => ({
  apiFetch: (...args: unknown[]): unknown => apiFetch(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("./device-session-cookie", () => ({
  writeDeviceBinding: (...args: unknown[]): unknown => writeDeviceBinding(...args),
  markUnlocked: (): unknown => markUnlocked(),
  markLocked: vi.fn(),
  clearDeviceBinding: vi.fn(),
  readDeviceBinding: (): unknown => readDeviceBinding(),
}));

import { submitPairingCode, unlockWithPin } from "./provisioning-actions";
import { buildMerchantDevice } from "../merchant-device";

const kemang = {
  region: "ID",
  label: "Kemang kasir 2",
  locationName: "Kemang",
};

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("a freshly paired counter knows its own region, label and shop (Group 5.13.g, B16)", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    writeDeviceBinding.mockReset();
    markUnlocked.mockReset();
    readDeviceBinding.mockReset();
  });

  it("keeps what the pair call returned, so the counter is Indonesian before any PIN is typed", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: { deviceId: "d1", credential: "secret", ...kemang },
    });

    await expect(submitPairingCode(form({ pairingCode: "ABCDEFGHJK" }))).rejects.toThrow(
      "redirect:/merchant",
    );

    expect(writeDeviceBinding).toHaveBeenCalledWith(expect.objectContaining(kemang));
    const binding = writeDeviceBinding.mock.calls[0]?.[0] as { deviceId: string; region: "ID" };
    const device = buildMerchantDevice({ id: binding.deviceId, region: binding.region });
    expect(device.locale).toBe("id-ID");
    expect(device.currency).toBe("IDR");
  });

  it("refreshes them on every real unlock", async () => {
    readDeviceBinding.mockResolvedValue({
      deviceId: "d1",
      credential: "secret",
      pairedAt: "2026-10-21T00:00:00.000Z",
    });
    apiFetch.mockResolvedValue({
      ok: true,
      data: { unlocked: true, locationId: "l1", ...kemang },
    });

    await expect(unlockWithPin(form({ pin: "2468" }))).rejects.toThrow("redirect:/merchant");

    expect(writeDeviceBinding).toHaveBeenCalledWith(expect.objectContaining(kemang));
  });
});

describe("buildMerchantDevice", () => {
  it("speaks Indonesian, in rupiah, for an ID counter, and Australian for an AU one", () => {
    expect(buildMerchantDevice({ id: "a", region: "ID" })).toMatchObject({
      locale: "id-ID",
      currency: "IDR",
    });
    expect(buildMerchantDevice({ id: "a", region: "AU" })).toMatchObject({
      locale: "en-AU",
      currency: "AUD",
    });
  });

  it("falls back to AU only for a binding saved before the region was kept", () => {
    expect(buildMerchantDevice({ id: "a" })).toMatchObject({ region: "AU", label: null });
  });
});
