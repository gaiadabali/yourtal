import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { Campaign } from "@yourtal/contracts/campaign";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import {
  CAMPAIGN_CARD_FOOTER_ROW_CLASS,
  CAMPAIGN_CARD_MERCHANT_ROW_CLASS,
  CAMPAIGN_CARD_META_ROW_CLASS,
  CAMPAIGN_CARD_TITLE_ROW_CLASS,
} from "./campaign-card-layout";
import { CampaignCard } from "./campaign-card";
import { CampaignCardSkeleton } from "./campaign-card-skeleton";

// mockCampaigns is a non-empty fixed-length (24) deterministic array — index 0 always exists.
const campaign: Campaign = mockCampaigns[0]!;

/**
 * Dimension-parity test for YT-0410's "skeletons match final dimensions
 * exactly so nothing shifts". Both components render through the shared
 * `CampaignCardLayout` frame, so this asserts the row wrappers carry the
 * exact same fixed-height classes in both the real card and its skeleton —
 * if a future edit gives one row a different height class than the other,
 * this test catches the drift instead of shipping a layout shift.
 */
describe("CampaignCard / CampaignCardSkeleton dimension parity", () => {
  it("gives every row the same fixed-height class in both the card and its skeleton", () => {
    const { container: cardContainer } = render(
      <CampaignCard campaign={campaign} locale="id-ID" />,
    );
    const { container: skeletonContainer } = render(<CampaignCardSkeleton />);

    for (const rowClass of [
      CAMPAIGN_CARD_MERCHANT_ROW_CLASS,
      CAMPAIGN_CARD_TITLE_ROW_CLASS,
      CAMPAIGN_CARD_META_ROW_CLASS,
      CAMPAIGN_CARD_FOOTER_ROW_CLASS,
    ]) {
      const selector = `.${rowClass.split(" ").join(".")}`;
      expect(
        cardContainer.querySelector(selector),
        `card row missing for "${rowClass}"`,
      ).not.toBeNull();
      expect(
        skeletonContainer.querySelector(selector),
        `skeleton row missing for "${rowClass}"`,
      ).not.toBeNull();
    }
  });
});
