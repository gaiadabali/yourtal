import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReportsScreen } from "./reports-screen";
import {
  buildCampaignFixtures,
  buildListingFixtures,
  buildQuestionFixtures,
  buildVoucherFixtures,
} from "./reports-fixtures";
import type { ReportsBundle } from "./reports-data";

const SCOPE = {
  businessId: "00000000-0000-4000-8000-000000009901",
  businessDisplayName: "Kopi Kenangan Test",
};

function buildBundle(): ReportsBundle {
  const campaigns = buildCampaignFixtures(SCOPE);
  const questionsByCampaignId: Record<string, ReturnType<typeof buildQuestionFixtures>> = {};
  for (const campaign of campaigns) {
    questionsByCampaignId[campaign.id] = buildQuestionFixtures(campaign);
  }
  const listings = buildListingFixtures(SCOPE);
  const vouchers = buildVoucherFixtures({ ...SCOPE, listings });
  return { campaigns, questionsByCampaignId, listings, vouchers };
}

describe("ReportsScreen", () => {
  it("always renders the provenance legend before any metric", () => {
    render(
      <ReportsScreen
        bundle={buildBundle()}
        relationships={["advertiser", "supplier"]}
        selectedCampaignId={undefined}
        businessQuery=""
        locale="en-AU"
      />,
    );
    expect(screen.getByRole("heading", { name: "How to read these numbers" })).toBeInTheDocument();
  });

  it("shows campaign and question-bank sections only when the business holds the advertiser relationship", () => {
    render(
      <ReportsScreen
        bundle={buildBundle()}
        relationships={["supplier"]}
        selectedCampaignId={undefined}
        businessQuery=""
        locale="en-AU"
      />,
    );
    expect(screen.queryByRole("heading", { name: "Campaigns" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Question bank composition" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Redemption ledger" })).toBeInTheDocument();
  });

  it("shows the redemption ledger only when the business holds the supplier relationship", () => {
    render(
      <ReportsScreen
        bundle={buildBundle()}
        relationships={["advertiser"]}
        selectedCampaignId={undefined}
        businessQuery=""
        locale="en-AU"
      />,
    );
    expect(screen.getByRole("heading", { name: "Campaigns" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Redemption ledger" })).not.toBeInTheDocument();
  });

  it("narrows the question-bank panel to one campaign when it is selected via the URL", () => {
    const bundle = buildBundle();
    const target = bundle.campaigns[0];
    if (!target) throw new Error("fixture produced no campaigns");

    render(
      <ReportsScreen
        bundle={bundle}
        relationships={["advertiser"]}
        selectedCampaignId={target.id}
        businessQuery=""
        locale="en-AU"
      />,
    );
    // The scope label under "Question bank composition" is the one place
    // the selected campaign's title appears as a description, not a link —
    // asserting via that heading's sibling avoids the ambiguity of the
    // title also appearing in the overview table row and the filter link.
    expect(
      screen.getByRole("heading", { name: "Question bank composition" }).closest("div"),
    ).toHaveTextContent(target.title);
  });

  it("shows an honest message rather than empty sections when the business holds neither relationship", () => {
    render(
      <ReportsScreen
        bundle={buildBundle()}
        relationships={["redeemer"]}
        selectedCampaignId={undefined}
        businessQuery=""
        locale="en-AU"
      />,
    );
    expect(screen.getByRole("heading", { name: "Nothing to report yet" })).toBeInTheDocument();
  });

  it("lists the gaps that are still genuinely true for an advertiser", () => {
    render(
      <ReportsScreen
        bundle={buildBundle()}
        relationships={["advertiser"]}
        selectedCampaignId={undefined}
        businessQuery=""
        locale="en-AU"
      />,
    );
    expect(screen.getByRole("heading", { name: "Completion by chapter" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Which campaign led to a redemption" }),
    ).toBeInTheDocument();
    // 12.3.e: re-verified against main and dropped — an aggregate question
    // accuracy is already computed and shown in the campaign performance
    // panel, and open/rewarded views are both real, separately-floored
    // numbers shown there too (see reports-campaign-metrics-panel.tsx).
    // Neither gap was still true, so neither renders here any more.
    expect(
      screen.queryByRole("heading", { name: /open views vs rewarded views/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /question accuracy.*recall/i }),
    ).not.toBeInTheDocument();
  });

  it("never renders anything shaped like a per-viewer identifier — aggregates only, no per-user drill-down path exists", () => {
    const { container } = render(
      <ReportsScreen
        bundle={buildBundle()}
        relationships={["advertiser", "supplier"]}
        selectedCampaignId={undefined}
        businessQuery=""
        locale="en-AU"
      />,
    );
    // No link or button anywhere targets a user/owner/viewer-scoped path or id.
    const interactive = within(container).queryAllByRole("link");
    for (const element of interactive) {
      const href = element.getAttribute("href") ?? "";
      expect(href).not.toMatch(/\/user\/|\/viewer\/|\/owner\/|ownerId/i);
    }
  });
});
