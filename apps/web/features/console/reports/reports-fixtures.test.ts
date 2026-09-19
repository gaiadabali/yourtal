import { describe, expect, it } from "vitest";
import {
  buildCampaignFixtures,
  buildListingFixtures,
  buildQuestionFixtures,
  buildVoucherFixtures,
} from "./reports-fixtures";

const SCOPE = {
  businessId: "00000000-0000-4000-8000-000000009901",
  businessDisplayName: "Kopi Kenangan Test",
};
const OTHER_SCOPE = {
  businessId: "00000000-0000-4000-8000-000000009902",
  businessDisplayName: "Another Business",
};

describe("reports-fixtures", () => {
  it("scopes every campaign's merchantId/merchantName to the given business, not a random one", () => {
    const campaigns = buildCampaignFixtures(SCOPE);
    expect(campaigns.length).toBeGreaterThan(0);
    for (const campaign of campaigns) {
      expect(campaign.merchantId).toBe(SCOPE.businessId);
      expect(campaign.merchantName).toBe(SCOPE.businessDisplayName);
    }
  });

  it("produces at least one active, one paused and one ended campaign so status-dependent UI has something to render", () => {
    const statuses = buildCampaignFixtures(SCOPE).map((campaign) => campaign.status);
    expect(statuses).toContain("active");
    expect(statuses).toContain("paused");
    expect(statuses).toContain("ended");
  });

  it("is deterministic for the same business id, and differs for a different one", () => {
    expect(buildCampaignFixtures(SCOPE)).toEqual(buildCampaignFixtures(SCOPE));
    const otherIds = buildCampaignFixtures(OTHER_SCOPE).map((campaign) => campaign.id);
    const theseIds = buildCampaignFixtures(SCOPE).map((campaign) => campaign.id);
    expect(otherIds).not.toEqual(theseIds);
  });

  it("builds exactly questionCount questions per campaign, scoped to that campaign's id, including zero", () => {
    const campaigns = buildCampaignFixtures(SCOPE);
    for (const campaign of campaigns) {
      const questions = buildQuestionFixtures(campaign);
      expect(questions).toHaveLength(campaign.questionCount);
      for (const question of questions) {
        expect(question.campaignId).toBe(campaign.id);
      }
    }
  });

  it("scopes listings to the business the same way campaigns are scoped", () => {
    const listings = buildListingFixtures(SCOPE);
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      expect(listing.merchantId).toBe(SCOPE.businessId);
    }
  });

  it("builds vouchers against the business's own listings, covering every voucher status", () => {
    const listings = buildListingFixtures(SCOPE);
    const vouchers = buildVoucherFixtures({ ...SCOPE, listings });
    const listingIds = new Set(listings.map((listing) => listing.id));
    const statuses = new Set(vouchers.map((voucher) => voucher.status));

    for (const voucher of vouchers) {
      expect(voucher.merchantId).toBe(SCOPE.businessId);
      expect(listingIds.has(voucher.listingId)).toBe(true);
    }
    expect(statuses).toEqual(new Set(["active", "redeemed", "expired", "transferred"]));
  });

  it("throws rather than silently producing an unattributed voucher when given no listings", () => {
    expect(() => buildVoucherFixtures({ ...SCOPE, listings: [] })).toThrow();
  });
});
