import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { toPoints } from "@yourtal/contracts/money";
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
  chapters: [
    { title: "Pembuka", startSeconds: 0, rewardWeight: 1 },
    { title: "Isi", startSeconds: 120, rewardWeight: 2 },
    { title: "Penutup", startSeconds: 300, rewardWeight: 5 },
  ],
  videoSource: { kind: "hls", manifestUrl: "https://mock.yourtal.test/hls/sample.m3u8" },
  estimatedDataMb: 200,
  rewardPoints: 1000,
  questionCount: 3,
  scoringRule: "base_plus_accuracy_bonus",
  status: "active",
  publishedAt: "2026-01-01T00:00:00.000Z",
  businessId: "00000000-0000-4000-8000-000000009901",
  region: "ID",
  audience: "all_ages",
  contentCategory: "food-and-drink",
  posterUrl: "https://mock.yourtal.test/poster.jpg",
  teaserUrl: "https://mock.yourtal.test/teaser.mp4",
  hlsUrl: "https://mock.yourtal.test/hls/sample.m3u8",
  captionsUrl: null,
  aspect: "16:9",
  estimatedBytes: 209_715_200,
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2026-04-01T00:00:00.000Z",
});

describe("ReportsCampaignOverviewTable", () => {
  it("renders one accessible table row per campaign with title, status, question count and scoring rule", () => {
    render(<ReportsCampaignOverviewTable campaigns={[CAMPAIGN]} locale="en-AU" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Kenali Produk Baru/ })).toBeInTheDocument();
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Base + accuracy bonus").length).toBeGreaterThan(0);
  });

  it("shows an honest empty state instead of a bare empty table when the business has no campaigns", () => {
    render(<ReportsCampaignOverviewTable campaigns={[]} locale="en-AU" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("This business has no live, paused or ended campaigns yet."),
    ).toBeInTheDocument();
  });

  it("shows each campaign's views, completions and points spent, and says so when the cohort floor hides them", () => {
    const other = { ...CAMPAIGN, id: "00000000-0000-4000-8000-000000000002", title: "Quiet one" };
    const third = { ...CAMPAIGN, id: "00000000-0000-4000-8000-000000000003", title: "No report" };
    const reports = {
      [CAMPAIGN.id]: {
        campaignId: CAMPAIGN.id,
        suppressed: false as const,
        rewardedViews: 1_240,
        completions: 860,
        completionRate: 860 / 1_240,
        averageWatchTimeSeconds: 96,
        questionAccuracy: 0.78,
        pointsSpent: toPoints(42_000),
        merchantVouchersRedeemed: 37,
        openViews: null,
      },
      [other.id]: { campaignId: other.id, suppressed: true as const, floor: 10, openViews: null },
      [third.id]: null,
    };
    render(
      <ReportsCampaignOverviewTable
        campaigns={[CAMPAIGN, other, third]}
        reports={reports}
        locale="en-AU"
      />,
    );
    const busy = screen.getByRole("row", { name: /Kenali Produk Baru/ });
    expect(within(busy).getByText("1,240")).toBeInTheDocument();
    expect(within(busy).getByText("860")).toBeInTheDocument();
    expect(within(busy).getByText("42,000")).toBeInTheDocument();
    const quiet = screen.getByRole("row", { name: /Quiet one/ });
    expect(within(quiet).getAllByText("Under 10 viewers so far")).toHaveLength(3);
    const missing = screen.getByRole("row", { name: /No report/ });
    expect(within(missing).getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("Measured")).toBeInTheDocument();
  });
});
