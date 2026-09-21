import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Campaign } from "@yourtal/contracts/campaign";
import {
  longMerchantNameCampaignFixture,
  mockCampaigns,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { CampaignCard } from "./campaign-card";

// mockCampaigns is a non-empty fixed-length (24) deterministic array — index 0 always exists.
const baseCampaign: Campaign = { ...mockCampaigns[0]!, scoringRule: "base_only" };

describe("CampaignCard", () => {
  it("shows duration, reward, estimated data cost and merchant — all four, per YT-0410", () => {
    render(<CampaignCard campaign={baseCampaign} locale="id-ID" />);
    expect(screen.getByText(baseCampaign.merchantName)).toBeInTheDocument();
    expect(screen.getByText(/menit|detik|jam/)).toBeInTheDocument();
    expect(screen.getByText(/~.*MB/)).toBeInTheDocument();
    expect(screen.getByText(/poin/)).toBeInTheDocument();
  });

  it("links to the campaign's entry card via its title as an accessible link", () => {
    render(<CampaignCard campaign={baseCampaign} locale="id-ID" />);
    const link = screen.getByRole("link", { name: baseCampaign.title });
    expect(link).toHaveAttribute("href", `/campaign/${baseCampaign.id}`);
  });

  it("words the reward as 'Hingga …' (up to) when an accuracy bonus applies, never combining it into one flat number", () => {
    const withBonus: Campaign = {
      ...baseCampaign,
      scoringRule: "base_plus_accuracy_bonus",
      questionCount: 3,
    };
    render(<CampaignCard campaign={withBonus} locale="id-ID" />);
    expect(screen.getByText(/^Hingga /)).toBeInTheDocument();
  });

  it("renders the zero-reward fixture plainly as 0 points, not blank or hidden", () => {
    render(<CampaignCard campaign={zeroRewardCampaignFixture} locale="id-ID" />);
    expect(screen.getByText("0 poin")).toBeInTheDocument();
  });

  it("truncates the 78-character merchant-name fixture to a single line instead of breaking layout", () => {
    render(<CampaignCard campaign={longMerchantNameCampaignFixture} locale="id-ID" />);
    const merchant = screen.getByTitle(longMerchantNameCampaignFixture.merchantName);
    expect(merchant).toHaveClass("truncate");
    expect(merchant.textContent).toBe(longMerchantNameCampaignFixture.merchantName);
  });

  it("renders the long-merchant-name fixture's title link without throwing", () => {
    render(<CampaignCard campaign={longMerchantNameCampaignFixture} locale="id-ID" />);
    expect(
      screen.getByRole("link", { name: longMerchantNameCampaignFixture.title }),
    ).toBeInTheDocument();
  });
});

describe("CampaignCard (en-AU, YT-0405)", () => {
  it("renders duration, reward and the quick badge in English, with no Indonesian copy leaking through", () => {
    const quickCampaign: Campaign = { ...baseCampaign, kind: "quick" };
    render(<CampaignCard campaign={quickCampaign} locale="en-AU" />);
    expect(screen.getByText("Quick")).toBeInTheDocument();
    expect(screen.getByText(/points$/)).toBeInTheDocument();
    expect(screen.queryByText("Cepat")).not.toBeInTheDocument();
    expect(screen.queryByText(/\bpoin\b/)).not.toBeInTheDocument();
  });

  it("words the reward as 'Up to …' in English when an accuracy bonus applies", () => {
    const withBonus: Campaign = {
      ...baseCampaign,
      scoringRule: "base_plus_accuracy_bonus",
      questionCount: 3,
    };
    render(<CampaignCard campaign={withBonus} locale="en-AU" />);
    expect(screen.getByText(/^Up to /)).toBeInTheDocument();
  });
});
