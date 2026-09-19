import { describe, expect, it } from "vitest";
import { generatePinSalt, hashPin, verifyPin } from "./pin-hash";

describe("pin-hash", () => {
  it("generatePinSalt returns a 32-character hex string and is not constant across calls", () => {
    const first = generatePinSalt();
    const second = generatePinSalt();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });

  it("hashPin is deterministic for the same pin and salt", async () => {
    const salt = generatePinSalt();
    expect(await hashPin("1234", salt)).toBe(await hashPin("1234", salt));
  });

  it("hashPin produces a different hash for the same PIN under a different salt", async () => {
    const hashA = await hashPin("1234", generatePinSalt());
    const hashB = await hashPin("1234", generatePinSalt());
    expect(hashA).not.toBe(hashB);
  });

  it("hashPin produces a different hash for a different PIN under the same salt", async () => {
    const salt = generatePinSalt();
    expect(await hashPin("1234", salt)).not.toBe(await hashPin("4321", salt));
  });

  it("verifyPin accepts the correct PIN and rejects an incorrect one", async () => {
    const salt = generatePinSalt();
    const hash = await hashPin("246810", salt);
    expect(await verifyPin("246810", salt, hash)).toBe(true);
    expect(await verifyPin("135791", salt, hash)).toBe(false);
  });

  it("verifyPin rejects a hash of different length without throwing", async () => {
    const salt = generatePinSalt();
    expect(await verifyPin("1234", salt, "short")).toBe(false);
  });
});
