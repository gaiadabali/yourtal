import { describe, expect, it } from "vitest";
import { deviceBindingSchema } from "./device-binding-schema";

const valid = {
  deviceId: "3f9a2b10-1111-4000-8000-000000000001",
  credential: "dc_live_abcdef1234567890",
  pairedAt: "2026-09-19T00:00:00.000Z",
};

describe("deviceBindingSchema", () => {
  it("accepts a well-formed binding", () => {
    expect(deviceBindingSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a binding with no region yet (before the first real unlock-with-PIN call)", () => {
    expect(deviceBindingSchema.safeParse(valid).success).toBe(true);
    expect(deviceBindingSchema.parse(valid).region).toBeUndefined();
  });

  it.each([
    ["AU", "AU"],
    ["ID", "ID"],
  ])("accepts a binding once region %s is known", (_label, region) => {
    const result = deviceBindingSchema.safeParse({ ...valid, region });
    expect(result.success).toBe(true);
  });

  it.each([
    ["missing deviceId", { ...valid, deviceId: undefined }],
    ["empty deviceId", { ...valid, deviceId: "" }],
    ["missing credential", { ...valid, credential: undefined }],
    ["empty credential", { ...valid, credential: "" }],
    ["non-ISO pairedAt", { ...valid, pairedAt: "yesterday" }],
    ["an unknown region", { ...valid, region: "NZ" }],
  ])("rejects %s", (_label, candidate) => {
    expect(deviceBindingSchema.safeParse(candidate).success).toBe(false);
  });
});
