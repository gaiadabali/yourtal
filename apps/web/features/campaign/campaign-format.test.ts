import { describe, expect, it } from "vitest";
import { formatDataCost, formatDuration } from "./campaign-format";

describe("formatDuration", () => {
  it("formats sub-minute durations in seconds (Quick campaigns)", () => {
    expect(formatDuration(45, "id-ID")).toBe("45 detik");
  });

  it("formats minute-scale durations rounded to the nearest minute", () => {
    expect(formatDuration(1_080, "id-ID")).toBe("18 menit");
  });

  it("formats hour-scale durations with a leading hour component", () => {
    expect(formatDuration(3_600, "id-ID")).toBe("1 jam");
    expect(formatDuration(5_400, "id-ID")).toBe("1 jam 30 menit");
  });
});

describe("formatDataCost", () => {
  it("shows one decimal place under 10 MB so small Quick campaigns are not rounded to 0", () => {
    expect(formatDataCost(2.1, "id-ID")).toBe("~2,1 MB");
  });

  it("rounds to the nearest whole MB at or above 10 MB and is always prefixed with a tilde", () => {
    expect(formatDataCost(210, "id-ID")).toBe("~210 MB");
  });

  it("never renders a bare number without the estimate tilde, per docs/06 §2.3", () => {
    expect(formatDataCost(90, "id-ID")).toMatch(/^~/);
  });
});

describe("en-AU locale (YT-0405)", () => {
  it("formats duration in English words with en-AU grouping", () => {
    expect(formatDuration(45, "en-AU")).toBe("45 sec");
    expect(formatDuration(1_080, "en-AU")).toBe("18 min");
    expect(formatDuration(5_400, "en-AU")).toBe("1 hr 30 min");
  });

  it("formats data cost with en-AU decimal grouping, still tilde-prefixed", () => {
    expect(formatDataCost(2.1, "en-AU")).toBe("~2.1 MB");
    expect(formatDataCost(210, "en-AU")).toBe("~210 MB");
  });
});
