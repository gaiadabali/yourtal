import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Listing } from "@yourtal/contracts/listing";
import { longMerchantNameCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import { publicLocaleConfig } from "./public-locale";
import { PublicMerchantContent } from "./public-merchant-content";
import type { PublicMerchant } from "./public-merchant";

function buildMerchant(overrides: Partial<PublicMerchant> = {}): PublicMerchant {
  return {
    slug: "kopi-sentosa",
    name: "Kopi Sentosa",
    district: "Kemang",
    campaigns: [],
    listings: [],
    ...overrides,
  };
}

describe("PublicMerchantContent", () => {
  it("shows the merchant name as the heading and its district", () => {
    render(
      <PublicMerchantContent
        merchant={buildMerchant()}
        locale="id"
        localeConfig={publicLocaleConfig("id")}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Kopi Sentosa" })).toBeInTheDocument();
    expect(screen.getByText(/Kemang/)).toBeInTheDocument();
  });

  it("links each campaign to its own campaign page", () => {
    const campaign: Campaign = longMerchantNameCampaignFixture;
    render(
      <PublicMerchantContent
        merchant={buildMerchant({ campaigns: [campaign] })}
        locale="id"
        localeConfig={publicLocaleConfig("id")}
      />,
    );
    expect(screen.getByRole("link", { name: campaign.title })).toHaveAttribute(
      "href",
      `/id/c/${campaign.id}`,
    );
  });

  it("links each offer to its own offer page under this merchant's slug", () => {
    const listing: Listing = soldOutListingFixture;
    render(
      <PublicMerchantContent
        merchant={buildMerchant({ listings: [listing] })}
        locale="id"
        localeConfig={publicLocaleConfig("id")}
      />,
    );
    expect(screen.getByRole("link", { name: listing.title })).toHaveAttribute(
      "href",
      "/id/rewards/kopi-sentosa/00000000-0000-4000-8000-000000000201",
    );
  });

  it("states plainly when a merchant has no live campaigns or offers, rather than an empty list", () => {
    render(
      <PublicMerchantContent
        merchant={buildMerchant()}
        locale="id"
        localeConfig={publicLocaleConfig("id")}
      />,
    );
    expect(screen.getByText(/belum ada campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/belum ada voucher/i)).toBeInTheDocument();
  });
});
