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
