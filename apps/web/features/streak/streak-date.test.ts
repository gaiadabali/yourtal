import { describe, expect, it } from "vitest";
import { dateKey, daysBetween } from "./streak-date";

describe("dateKey", () => {
  it("formats a UTC instant as YYYY-MM-DD", () => {
    expect(dateKey(new Date("2026-09-20T23:59:00.000Z"))).toBe("2026-09-20");
  });

  it("uses the UTC day even when the local wall-clock has already rolled over — documented in the module's doc comment", () => {
    // Just after UTC midnight is still "today" in UTC terms.
    expect(dateKey(new Date("2026-09-21T00:00:01.000Z"))).toBe("2026-09-21");
  });
});

describe("daysBetween", () => {
  it("is 0 for the same day", () => {
    expect(daysBetween("2026-09-20", "2026-09-20")).toBe(0);
  });

  it("is 1 for consecutive days", () => {
    expect(daysBetween("2026-09-20", "2026-09-21")).toBe(1);
  });

  it("is 2 across a missed day", () => {
    expect(daysBetween("2026-09-20", "2026-09-22")).toBe(2);
  });

  it("is negative when b precedes a", () => {
    expect(daysBetween("2026-09-21", "2026-09-20")).toBe(-1);
  });

  it("crosses a month boundary correctly", () => {
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
  });
});
