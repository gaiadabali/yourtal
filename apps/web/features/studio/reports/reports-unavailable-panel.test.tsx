import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsUnavailablePanel } from "./reports-unavailable-panel";
import type { UnavailableMetric } from "./reports-unavailable-metrics";

const METRIC: UnavailableMetric = {
  id: "test-metric",
  label: "Completion by chapter",
  requiresRelationship: "advertiser",
  reason: "campaignSchema carries no chapter data, so this cannot be computed honestly.",
};

describe("ReportsUnavailablePanel", () => {
  it("names the metric, states the reason, and labels it 'Not available' rather than showing a number", () => {
    render(<ReportsUnavailablePanel metric={METRIC} />);
    expect(screen.getByRole("heading", { name: "Completion by chapter" })).toBeInTheDocument();
    expect(screen.getByText(METRIC.reason)).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });
});
