import { describe, expect, it } from "vitest";
import { updateChannelSettingsSchema } from "./update-channel-settings.schema";

const valid = {
  displayName: "Kopi Kenangan",
  handle: "kopi-kenangan",
  logoUrl: "https://cdn.example.com/logo.png",
  coverUrl: null,
};

describe("updateChannelSettingsSchema", () => {
  it("accepts a name, a handle and https or empty image links", () => {
    expect(updateChannelSettingsSchema.parse(valid)).toStrictEqual(valid);
  });

  it.each([
    ["an empty name", { displayName: " " }],
    ["a handle with capitals", { handle: "Kopi" }],
    ["a handle that is too short", { handle: "ab" }],
    ["an http logo", { logoUrl: "http://cdn.example.com/logo.png" }],
    ["a javascript cover", { coverUrl: "javascript:alert(1)" }],
    ["a region field", { region: "ID" }],
  ])("rejects %s", (_name, overrides) => {
    const result = updateChannelSettingsSchema.strict().safeParse({ ...valid, ...overrides });
    expect(result.success).toBe(false);
  });
});
