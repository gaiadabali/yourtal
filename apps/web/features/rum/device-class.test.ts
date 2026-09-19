import { describe, expect, it } from "vitest";
import { classifyDevice } from "./device-class";

describe("classifyDevice", () => {
  it("is 'unknown' when neither signal is available (Safari/Firefox today)", () => {
    expect(classifyDevice(undefined, undefined)).toBe("unknown");
  });

  it("classifies the documented mid-tier Jakarta Android target (docs/08 §3) as 'mid', not 'low' or 'high'", () => {
    expect(classifyDevice(8, 4)).toBe("mid");
  });

  it("classifies low memory as 'low' even with many cores", () => {
    expect(classifyDevice(8, 2)).toBe("low");
  });

  it("classifies few cores as 'low' even with generous memory", () => {
    expect(classifyDevice(2, 8)).toBe("low");
  });

  it("classifies a high-end device as 'high' only when both signals clear the bar", () => {
    expect(classifyDevice(12, 16)).toBe("high");
  });

  it("falls back to 'mid' rather than guessing 'high' when only one signal is present and it does not clear the low bar", () => {
    expect(classifyDevice(6, undefined)).toBe("mid");
  });
});
