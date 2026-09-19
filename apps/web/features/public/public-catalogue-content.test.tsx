import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { soldOutListingFixture, expiringSoonListingFixture } from "@yourtal/contracts/listing/mock";
import { publicLocaleConfig } from "./public-locale";
import { PublicCatalogueContent } from "./public-catalogue-content";

describe("PublicCatalogueContent", () => {
  it("renders one link per listing, pointing at its merchant-scoped offer URL", () => {
    render(
      <PublicCatalogueContent
        listings={[soldOutListingFixture, expiringSoonListingFixture]}
        locale="id"
        localeConfig={publicLocaleConfig("id")}
      />,
    );
    expect(screen.getByRole("link", { name: soldOutListingFixture.title })).toHaveAttribute(
      "href",
      `/id/rewards/kopi-sentosa/${soldOutListingFixture.id}`,
    );
    expect(screen.getByRole("link", { name: expiringSoonListingFixture.title })).toHaveAttribute(
      "href",
      `/id/rewards/toko-berkah/${expiringSoonListingFixture.id}`,
    );
  });

  it("shows both the points price and the face value for each listing", () => {
    render(
      <PublicCatalogueContent
        listings={[soldOutListingFixture]}
        locale="id"
        localeConfig={publicLocaleConfig("id")}
      />,
    );
    expect(screen.getByText(/Rp30\.000/)).toBeInTheDocument();
  });
});
