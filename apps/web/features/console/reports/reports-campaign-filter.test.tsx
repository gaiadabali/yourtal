import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsCampaignFilter } from "./reports-campaign-filter";

const OPTIONS = [
  { id: "00000000-0000-4000-8000-000000000001", label: "Campaign One" },
  { id: "00000000-0000-4000-8000-000000000002", label: "Campaign Two" },
];

describe("ReportsCampaignFilter", () => {
  it("renders 'All campaigns' plus one link per campaign, all as real navigable links", () => {
    render(
      <ReportsCampaignFilter options={OPTIONS} selectedCampaignId={undefined} businessQuery="" />,
    );
    expect(screen.getByRole("link", { name: "All campaigns" })).toHaveAttribute(
      "href",
      "/business/reports",
    );
    expect(screen.getByRole("link", { name: "Campaign One" })).toHaveAttribute(
      "href",
      "/business/reports?campaign=00000000-0000-4000-8000-000000000001",
    );
  });

  it("marks the selected campaign current and 'All campaigns' not current", () => {
    render(
      <ReportsCampaignFilter
        options={OPTIONS}
        selectedCampaignId="00000000-0000-4000-8000-000000000002"
        businessQuery=""
      />,
    );
    expect(screen.getByRole("link", { name: "Campaign Two" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "All campaigns" })).not.toHaveAttribute("aria-current");
  });

  it("preserves an existing ?business= query when adding ?campaign=, never dropping the business switcher's selection", () => {
    render(
      <ReportsCampaignFilter
        options={OPTIONS}
        selectedCampaignId={undefined}
        businessQuery="?business=00000000-0000-4000-8000-000000000601"
      />,
    );
    expect(screen.getByRole("link", { name: "Campaign One" })).toHaveAttribute(
      "href",
      "/business/reports?business=00000000-0000-4000-8000-000000000601&campaign=00000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByRole("link", { name: "All campaigns" })).toHaveAttribute(
      "href",
      "/business/reports?business=00000000-0000-4000-8000-000000000601",
    );
  });
});
