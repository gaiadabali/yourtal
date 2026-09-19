import { describe, expect, it, vi } from "vitest";
import { requireRegionParam } from "./onboarding-region-param";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

describe("requireRegionParam", () => {
  it("accepts the two real region codes", () => {
    expect(requireRegionParam("AU")).toBe("AU");
    expect(requireRegionParam("ID")).toBe("ID");
  });

  it("is forgiving of the URL segment's case", () => {
    expect(requireRegionParam("au")).toBe("AU");
    expect(requireRegionParam("id")).toBe("ID");
  });

  it("404s on any other value, including a plausible-looking but unsupported region", () => {
    expect(() => requireRegionParam("US")).toThrow("NEXT_NOT_FOUND");
    expect(() => requireRegionParam("")).toThrow("NEXT_NOT_FOUND");
  });
});
