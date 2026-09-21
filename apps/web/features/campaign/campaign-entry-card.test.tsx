import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Campaign } from "@yourtal/contracts/campaign";
import {
  longMerchantNameCampaignFixture,
  mockCampaigns,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { CampaignEntryCard } from "./campaign-entry-card";

// mockCampaigns is a non-empty fixed-length (24) deterministic array — index 0 always exists.
const withBonus: Campaign = {
  ...mockCampaigns[0]!,
  scoringRule: "base_plus_accuracy_bonus",
  questionCount: 3,
};

describe("CampaignEntryCard", () => {
  it("states duration, data cost, question count and scoring rule as plain text, with no expansion needed", () => {
    render(<CampaignEntryCard campaign={withBonus} locale="id-ID" />);
    expect(screen.getByText("Durasi")).toBeInTheDocument();
    expect(screen.getByText("Estimasi data")).toBeInTheDocument();
    expect(screen.getByText("Pertanyaan")).toBeInTheDocument();
    expect(screen.getByText("Aturan penilaian")).toBeInTheDocument();
    // None of these facts sit behind a disclosure control.
    expect(
      screen.queryByRole("button", { name: /detail|lihat lebih|expand/i }),
    ).not.toBeInTheDocument();
  });

  it("states the duration before the single primary action, in document order", () => {
    const { container } = render(<CampaignEntryCard campaign={withBonus} locale="id-ID" />);
    const html = container.innerHTML;
    expect(html.indexOf("Durasi")).toBeLessThan(html.indexOf("Mulai video"));
  });

  it("shows the base reward and the accuracy bonus as two separate figures, never combined into one", () => {
    render(<CampaignEntryCard campaign={withBonus} locale="id-ID" />);
    expect(screen.getByText("Reward dasar")).toBeInTheDocument();
    expect(screen.getByText("Bonus akurasi")).toBeInTheDocument();
    expect(screen.getByText(/^Hingga \+/)).toBeInTheDocument();
  });

  it("omits the bonus row entirely for a base_only campaign rather than showing a zero bonus", () => {
    render(
      <CampaignEntryCard campaign={{ ...withBonus, scoringRule: "base_only" }} locale="id-ID" />,
    );
    expect(screen.queryByText("Bonus akurasi")).not.toBeInTheDocument();
  });

  it("has exactly one primary action", () => {
    render(<CampaignEntryCard campaign={withBonus} locale="id-ID" />);
    const actions = [...screen.queryAllByRole("link"), ...screen.queryAllByRole("button")];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveTextContent("Mulai video");
  });

  it("the primary action points at the watch route for this campaign", () => {
    render(<CampaignEntryCard campaign={withBonus} locale="id-ID" />);
    expect(screen.getByRole("link", { name: "Mulai video" })).toHaveAttribute(
      "href",
      `/watch/${withBonus.id}`,
    );
  });

  it("states plainly that these terms are the terms honoured", () => {
    render(<CampaignEntryCard campaign={withBonus} locale="id-ID" />);
    expect(screen.getByText(/ketentuan.*akan dihormati/i)).toBeInTheDocument();
  });

  it("renders the zero-reward fixture's 0-point reward plainly rather than hiding it", () => {
    render(<CampaignEntryCard campaign={zeroRewardCampaignFixture} locale="id-ID" />);
    expect(screen.getByText("0 poin")).toBeInTheDocument();
  });

  it("renders the long-merchant-name fixture without throwing", () => {
    expect(() =>
      render(<CampaignEntryCard campaign={longMerchantNameCampaignFixture} locale="id-ID" />),
    ).not.toThrow();
    expect(screen.getByText("Tidak ada pertanyaan")).toBeInTheDocument();
  });
});

describe("CampaignEntryCard (en-AU, YT-0405)", () => {
  it("states duration, data cost, question count and scoring rule labels in English", () => {
    render(<CampaignEntryCard campaign={withBonus} locale="en-AU" />);
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("Estimated data")).toBeInTheDocument();
    expect(screen.getByText("Questions")).toBeInTheDocument();
    expect(screen.getByText("Scoring rule")).toBeInTheDocument();
  });

  it("shows base reward and accuracy bonus labels in English, worded 'Up to +…'", () => {
    render(<CampaignEntryCard campaign={withBonus} locale="en-AU" />);
    expect(screen.getByText("Base reward")).toBeInTheDocument();
    expect(screen.getByText("Accuracy bonus")).toBeInTheDocument();
    expect(screen.getByText(/^Up to \+/)).toBeInTheDocument();
  });

  it("states the guarantee and primary action in English, with no Indonesian copy leaking through", () => {
    const { container } = render(<CampaignEntryCard campaign={withBonus} locale="en-AU" />);
    expect(screen.getByText("Guarantee")).toBeInTheDocument();
    expect(screen.getByText(/terms shown on this page are the terms honoured/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start video" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Durasi|Jaminan|Mulai video|ketentuan/i);
  });
});
