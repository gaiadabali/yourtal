import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsUnavailablePanel } from "./reports-unavailable-panel";
import type { UnavailableMetric } from "./reports-unavailable-metrics";

// A real id from `studio.json`'s `reports.gaps` — the panel resolves its
// own copy from there now (plain business language, no code references),
// rather than carrying `label`/`reason` on the metric itself.
const METRIC: UnavailableMetric = {
  id: "completion-by-chapter",
  requiresRelationship: "advertiser",
};

describe("ReportsUnavailablePanel", () => {
  it("names the metric, states the reason, and labels it 'Not available' rather than showing a number", () => {
    render(<ReportsUnavailablePanel metric={METRIC} locale="en-AU" />);
    expect(screen.getByRole("heading", { name: "Completion by chapter" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "We can show whether a viewer finished a video, but not yet how many people make it through each individual chapter.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });
});
