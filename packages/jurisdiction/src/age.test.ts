import { describe, expect, it } from "vitest";
import { ageBandFrom, ageYearsFrom } from "./age";

describe("ageYearsFrom", () => {
  it("counts a birthday that already happened this year", () => {
    expect(ageYearsFrom("2008-01-01", new Date("2026-09-25T00:00:00Z"))).toBe(18);
  });

  it("does not count a birthday that has not happened yet this year", () => {
    expect(ageYearsFrom("2008-12-31", new Date("2026-09-25T00:00:00Z"))).toBe(17);
  });

  it("counts a birthday that is exactly today", () => {
    expect(ageYearsFrom("2013-09-25", new Date("2026-09-25T00:00:00Z"))).toBe(13);
  });
});

describe("ageBandFrom", () => {
  it("is teen for 13-17", () => {
    expect(ageBandFrom(13)).toBe("teen");
    expect(ageBandFrom(17)).toBe("teen");
  });

  it("is adult for 18+", () => {
    expect(ageBandFrom(18)).toBe("adult");
    expect(ageBandFrom(99)).toBe("adult");
  });
});
