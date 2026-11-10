import { describe, expect, it } from "vitest";
import { recentQuarters } from "./gst-quarters";

describe("recentQuarters", () => {
  it("counts back across a year boundary, newest first", () => {
    expect(recentQuarters(new Date("2026-02-10T00:00:00Z"), 3)).toEqual([
      "2026-Q1",
      "2025-Q4",
      "2025-Q3",
    ]);
  });
  it("puts a November date in Q4", () => {
    expect(recentQuarters(new Date("2026-11-11T00:00:00Z"), 1)).toEqual(["2026-Q4"]);
  });
});
