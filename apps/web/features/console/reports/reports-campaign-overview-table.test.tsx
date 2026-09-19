import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { ReportsCampaignOverviewTable } from "./reports-campaign-overview-table";

const CAMPAIGN = campaignSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "long_form",
  title: "Kenali Produk Baru",
  merchantId: "00000000-0000-4000-8000-000000009901",
  merchantName: "Test Business",
  synopsis: "A synopsis long enough to pass validation.",
  durationSeconds: 600,
  estimatedDataMb: 200,
  rewardPoints: 1000,
  questionCount: 3,
  scoringRule: "base_plus_accuracy_bonus",
  status: "active",
  publishedAt: "2026-01-01T00:00:00.000Z",
});

describe("ReportsCampaignOverviewTable", () => {
  it("renders one accessible table row per campaign with title, status, question count and scoring rule", () => {
    render(<ReportsCampaignOverviewTable campaigns={[CAMPAIGN]} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Kenali Produk Baru/ })).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Base + accuracy bonus")).toBeInTheDocument();
  });

  it("shows an honest empty state instead of a bare empty table when the business has no campaigns", () => {
    render(<ReportsCampaignOverviewTable campaigns={[]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("This business has no campaigns yet.")).toBeInTheDocument();
  });
});
