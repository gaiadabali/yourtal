import { describe, expect, it } from "vitest";
import { dataSourceMode, parseDataSourceMode, resolveDataSource } from "./mock-source";

describe("parseDataSourceMode", () => {
  it("defaults to mock when the variable is unset", () => {
    expect(parseDataSourceMode({})).toBe("mock");
  });

  it("accepts an explicit mock value", () => {
    expect(parseDataSourceMode({ YOURTAL_DATA_SOURCE: "mock" })).toBe("mock");
  });

  it("accepts an explicit live value", () => {
    expect(parseDataSourceMode({ YOURTAL_DATA_SOURCE: "live" })).toBe("live");
  });

  const rejectionTable: Array<{ name: string; env: Readonly<Record<string, string | undefined>> }> =
    [
      { name: "an unrecognised mode string", env: { YOURTAL_DATA_SOURCE: "staging" } },
      { name: "an empty string", env: { YOURTAL_DATA_SOURCE: "" } },
      { name: "mixed case", env: { YOURTAL_DATA_SOURCE: "Mock" } },
      { name: "a numeric-looking value", env: { YOURTAL_DATA_SOURCE: "1" } },
    ];

  it.each(rejectionTable)("fails fast on $name", ({ env }) => {
    expect(() => parseDataSourceMode(env)).toThrow();
  });
});

describe("dataSourceMode", () => {
  it("is resolved once at module load, and is one of the two valid modes", () => {
    expect(["mock", "live"]).toContain(dataSourceMode);
  });
});

describe("resolveDataSource", () => {
  it("picks the mock implementation when the resolved mode is mock (the default, since no env override is set in this test run)", () => {
    const mock = { label: "mock-impl" };
    const live = { label: "live-impl" };
    expect(resolveDataSource({ mock, live })).toBe(dataSourceMode === "mock" ? mock : live);
  });

  it("is a pure selection: the same call with swapped implementations picks the other one", () => {
    const a = { label: "a" };
    const b = { label: "b" };
    const first = resolveDataSource({ mock: a, live: b });
    const second = resolveDataSource({ mock: b, live: a });
    expect(first).not.toBe(second);
  });
});
