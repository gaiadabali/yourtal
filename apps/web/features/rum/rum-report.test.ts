import { describe, expect, it } from "vitest";
import { buildRumSample, isBudgetBreach } from "./rum-report";

const BASE_INPUT = {
  country: "ID" as const,
  connectionType: "4g",
  deviceClass: "mid" as const,
  pathname: "/watch/abc-123",
  now: new Date("2026-09-20T12:00:00.000Z"),
};

describe("buildRumSample", () => {
  it("carries every segmentation dimension AC2 asks for: country, connection, device class", () => {
    const sample = buildRumSample({ ...BASE_INPUT, metric: "LCP", value: 1800 });
    expect(sample.country).toBe("ID");
    expect(sample.connectionType).toBe("4g");
    expect(sample.deviceClass).toBe("mid");
    expect(sample.pathname).toBe("/watch/abc-123");
  });

  it("rates the sample against the platform's own field budget", () => {
    const good = buildRumSample({ ...BASE_INPUT, metric: "LCP", value: 1500 });
    const poor = buildRumSample({ ...BASE_INPUT, metric: "LCP", value: 3000 });
    expect(good.rating).toBe("good");
    expect(poor.rating).toBe("poor");
  });

  it("stamps an RFC 3339 UTC timestamp (docs/13-engineering-standards.md §5)", () => {
    const sample = buildRumSample({ ...BASE_INPUT, metric: "CLS", value: 0.05 });
    expect(sample.timestamp).toBe("2026-09-20T12:00:00.000Z");
  });
});

describe("isBudgetBreach", () => {
  it("is true only for a 'poor' rating", () => {
    const poor = buildRumSample({ ...BASE_INPUT, metric: "INP", value: 500 });
    const good = buildRumSample({ ...BASE_INPUT, metric: "INP", value: 100 });
    expect(isBudgetBreach(poor)).toBe(true);
    expect(isBudgetBreach(good)).toBe(false);
  });
});
