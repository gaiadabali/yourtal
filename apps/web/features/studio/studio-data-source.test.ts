import { describe, expect, it } from "vitest";
import {
  resolveStudioDataSource,
  resolveStudioDataSourceMode,
  studioDataSourceMode,
} from "./studio-data-source";

describe("resolveStudioDataSourceMode", () => {
  it("defaults to mock when nothing is set — plain local dev, unchanged", () => {
    expect(resolveStudioDataSourceMode({})).toBe("mock");
  });

  it("resolves to live on staging, with no explicit override", () => {
    expect(resolveStudioDataSourceMode({ APP_ENV: "staging" })).toBe("live");
  });

  it("resolves to live on production, with no explicit override", () => {
    expect(resolveStudioDataSourceMode({ APP_ENV: "production" })).toBe("live");
  });

  it("stays mock for any other APP_ENV value", () => {
    expect(resolveStudioDataSourceMode({ APP_ENV: "development" })).toBe("mock");
    expect(resolveStudioDataSourceMode({ APP_ENV: "test" })).toBe("mock");
  });

  it("YOURTAL_DATA_SOURCE=live overrides local dev with no APP_ENV set — unchanged existing behaviour", () => {
    expect(resolveStudioDataSourceMode({ YOURTAL_DATA_SOURCE: "live" })).toBe("live");
  });

  it("an explicit YOURTAL_DATA_SOURCE=mock overrides staging back to mock", () => {
    expect(resolveStudioDataSourceMode({ APP_ENV: "staging", YOURTAL_DATA_SOURCE: "mock" })).toBe(
      "mock",
    );
  });

  it("an explicit YOURTAL_DATA_SOURCE=live is consistent with staging's own default", () => {
    expect(resolveStudioDataSourceMode({ APP_ENV: "staging", YOURTAL_DATA_SOURCE: "live" })).toBe(
      "live",
    );
  });

  it("fails fast on an invalid explicit YOURTAL_DATA_SOURCE, even on staging", () => {
    expect(() =>
      resolveStudioDataSourceMode({ APP_ENV: "staging", YOURTAL_DATA_SOURCE: "banana" }),
    ).toThrow();
  });

  it("fails fast on an invalid explicit YOURTAL_DATA_SOURCE with no APP_ENV — same fail-fast parse as the shared switch", () => {
    expect(() => resolveStudioDataSourceMode({ YOURTAL_DATA_SOURCE: "banana" })).toThrow();
  });
});

describe("studioDataSourceMode", () => {
  it("is resolved once at module load, and is one of the two valid modes", () => {
    expect(["mock", "live"]).toContain(studioDataSourceMode);
  });
});

describe("resolveStudioDataSource", () => {
  it("picks the mock implementation when the resolved mode is mock (the default, since no env override is set in this test run)", () => {
    const mock = { label: "mock-impl" };
    const live = { label: "live-impl" };
    expect(resolveStudioDataSource({ mock, live })).toBe(
      studioDataSourceMode === "mock" ? mock : live,
    );
  });

  it("is a pure selection: the same call with swapped implementations picks the other one", () => {
    const a = { label: "a" };
    const b = { label: "b" };
    const first = resolveStudioDataSource({ mock: a, live: b });
    const second = resolveStudioDataSource({ mock: b, live: a });
    expect(first).not.toBe(second);
  });
});
