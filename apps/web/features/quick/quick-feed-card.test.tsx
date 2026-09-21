import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Campaign } from "@yourtal/contracts/campaign";
import { longMerchantNameCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { QuickFeedCard } from "./quick-feed-card";

// longMerchantNameCampaignFixture is a real, schema-valid `quick` fixture
// (30s, 150 points, base_only) — reused here rather than hand-rolling a
// parallel one, and overridden per test for the one field each test cares
// about.
const quickCampaign: Campaign = longMerchantNameCampaignFixture;

describe("QuickFeedCard", () => {
  it("states merchant, duration, estimated data cost and reward, all in plain text", () => {
    render(
      <ul>
        <QuickFeedCard campaign={quickCampaign} position={1} total={3} locale="id-ID" />
      </ul>,
    );
    expect(screen.getByText(quickCampaign.merchantName)).toBeInTheDocument();
    expect(screen.getByText(/menit|detik/)).toBeInTheDocument();
    expect(screen.getByText(/~.*MB/)).toBeInTheDocument();
    expect(screen.getByText(/poin/)).toBeInTheDocument();
  });

  it("links straight to the watch route via its title, the card's only interactive element", () => {
    render(
      <ul>
        <QuickFeedCard campaign={quickCampaign} position={1} total={3} locale="id-ID" />
      </ul>,
    );
    const link = screen.getByRole("link", { name: quickCampaign.title });
    expect(link).toHaveAttribute("href", `/watch/${quickCampaign.id}`);
  });

  it("words the reward as 'Hingga …' when an accuracy bonus applies, never one flat inflated number", () => {
    const withBonus: Campaign = {
      ...quickCampaign,
      scoringRule: "base_plus_accuracy_bonus",
      questionCount: 2,
    };
    render(
      <ul>
        <QuickFeedCard campaign={withBonus} position={1} total={1} locale="id-ID" />
      </ul>,
    );
    expect(screen.getByText(/^Hingga /)).toBeInTheDocument();
  });

  it("renders no video element and no play control — nothing here can start media on its own", () => {
    const { container } = render(
      <ul>
        <QuickFeedCard campaign={quickCampaign} position={1} total={3} locale="id-ID" />
      </ul>,
    );
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play|mulai|tonton/i })).not.toBeInTheDocument();
  });

  it("carries a machine-readable position label for the feed's screen-reader status region", () => {
    render(
      <ul>
        <QuickFeedCard campaign={quickCampaign} position={2} total={5} locale="id-ID" />
      </ul>,
    );
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("data-quick-feed-label")).toContain("Video 2 dari 5");
  });

  it("truncates the long-merchant-name fixture to a single line instead of breaking layout", () => {
    render(
      <ul>
        <QuickFeedCard campaign={quickCampaign} position={1} total={1} locale="id-ID" />
      </ul>,
    );
    const merchant = screen.getByTitle(quickCampaign.merchantName);
    expect(merchant).toHaveClass("truncate");
    expect(merchant.textContent).toBe(quickCampaign.merchantName);
  });
});

describe("QuickFeedCard (en-AU, YT-0405)", () => {
  it("states duration, estimated data cost and reward in English, with no Indonesian copy leaking through", () => {
    render(
      <ul>
        <QuickFeedCard campaign={quickCampaign} position={1} total={3} locale="en-AU" />
      </ul>,
    );
    expect(screen.getByText(/points$/)).toBeInTheDocument();
    expect(screen.queryByText(/\bpoin\b/)).not.toBeInTheDocument();
  });

  it("words the reward as 'Up to …' in English when an accuracy bonus applies", () => {
    const withBonus: Campaign = {
      ...quickCampaign,
      scoringRule: "base_plus_accuracy_bonus",
      questionCount: 2,
    };
    render(
      <ul>
        <QuickFeedCard campaign={withBonus} position={1} total={1} locale="en-AU" />
      </ul>,
    );
    expect(screen.getByText(/^Up to /)).toBeInTheDocument();
  });

  it("carries an English screen-reader position label", () => {
    render(
      <ul>
        <QuickFeedCard campaign={quickCampaign} position={2} total={5} locale="en-AU" />
      </ul>,
    );
    const item = screen.getByRole("listitem");
    expect(item.getAttribute("data-quick-feed-label")).toContain("Video 2 of 5");
  });
});
