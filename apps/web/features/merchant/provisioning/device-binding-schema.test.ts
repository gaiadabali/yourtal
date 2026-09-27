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

  it.each([
    ["missing deviceId", { ...valid, deviceId: undefined }],
    ["empty deviceId", { ...valid, deviceId: "" }],
    ["missing credential", { ...valid, credential: undefined }],
    ["empty credential", { ...valid, credential: "" }],
    ["non-ISO pairedAt", { ...valid, pairedAt: "yesterday" }],
  ])("rejects %s", (_label, candidate) => {
    expect(deviceBindingSchema.safeParse(candidate).success).toBe(false);
  });
});
