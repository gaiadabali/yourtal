import { describe, expect, it } from "vitest";
import { deviceBindingSchema } from "./device-binding-schema";

const valid = {
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

describe("deviceBindingSchema", () => {
  it("accepts a well-formed binding", () => {
    expect(deviceBindingSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["missing merchantId", { ...valid, merchantId: undefined }],
    ["empty label", { ...valid, label: "" }],
    ["unsupported locale", { ...valid, locale: "fr-FR" }],
    ["unsupported currency", { ...valid, currency: "USD" }],
    ["non-ISO provisionedAt", { ...valid, provisionedAt: "yesterday" }],
    ["missing pinHash", { ...valid, pinHash: undefined }],
    ["missing pinSalt", { ...valid, pinSalt: undefined }],
  ])("rejects %s", (_label, candidate) => {
    expect(deviceBindingSchema.safeParse(candidate).success).toBe(false);
  });
});
