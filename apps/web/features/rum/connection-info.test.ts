import { describe, expect, it } from "vitest";
import { readEffectiveConnectionType } from "./connection-info";

describe("readEffectiveConnectionType", () => {
  it("reads effectiveType when present", () => {
    expect(readEffectiveConnectionType({ effectiveType: "4g" })).toBe("4g");
  });

  it("is 'unknown' when the Network Information API is unavailable (Safari, Firefox)", () => {
    expect(readEffectiveConnectionType(null)).toBe("unknown");
    expect(readEffectiveConnectionType(undefined)).toBe("unknown");
  });

  it("is 'unknown' when connection exists but effectiveType does not", () => {
    expect(readEffectiveConnectionType({})).toBe("unknown");
  });
});
