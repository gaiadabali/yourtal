import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { ReportsCampaignMetricsPanel } from "./reports-campaign-metrics-panel";

describe("ReportsCampaignMetricsPanel", () => {
  it("renders nothing when no campaign is selected", () => {
    const { container } = render(<ReportsCampaignMetricsPanel report={undefined} locale="en-AU" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an honest not-found gap rather than fabricated numbers", () => {
    render(<ReportsCampaignMetricsPanel report={null} locale="en-AU" />);
    expect(screen.getByText(/No report is available/)).toBeInTheDocument();
  });

  it("shows the suppressed-below-floor message with the real floor, not any number", () => {
    render(
      <ReportsCampaignMetricsPanel
        report={{ campaignId: "00000000-0000-4000-8000-000000000001", suppressed: true, floor: 10 }}
        locale="en-AU"
      />,
    );
    expect(screen.getByText(/at least 10 people/)).toBeInTheDocument();
    expect(screen.queryByText("Rewarded views")).not.toBeInTheDocument();
  });

  it("renders the real aggregates when the campaign clears the floor", () => {
    render(
      <ReportsCampaignMetricsPanel
        report={{
          campaignId: "00000000-0000-4000-8000-000000000001",
          suppressed: false,
          rewardedViews: 1_240,
          completions: 860,
          completionRate: 860 / 1_240,
          averageWatchTimeSeconds: 96,
          questionAccuracy: 0.78,
          pointsSpent: toPoints(42_000),
          merchantVouchersRedeemed: 37,
        }}
        locale="en-AU"
      />,
    );
    expect(screen.getByText("1240")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("96s")).toBeInTheDocument();
  });
});
