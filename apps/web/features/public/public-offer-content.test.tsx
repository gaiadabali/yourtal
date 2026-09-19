import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { soldOutListingFixture, expiringSoonListingFixture } from "@yourtal/contracts/listing/mock";
import { publicLocaleConfig } from "./public-locale";
import { PublicOfferContent } from "./public-offer-content";

describe("PublicOfferContent", () => {
  it("shows the title as the page heading and links the merchant name", () => {
    render(
      <PublicOfferContent
        listing={soldOutListingFixture}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/kopi-sentosa"
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: soldOutListingFixture.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kopi Sentosa" })).toHaveAttribute(
      "href",
      "/id/m/kopi-sentosa",
    );
  });

  it("names the genuine face value and the points price together in the call to action", () => {
    render(
      <PublicOfferContent
        listing={soldOutListingFixture}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/kopi-sentosa"
      />,
    );
    expect(screen.getByText(/Rp30\.000/)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /daftar/i });
    expect(cta).toHaveAttribute("href", "/onboarding");
  });

  it("badges a sold-out listing", () => {
    render(
      <PublicOfferContent
        listing={soldOutListingFixture}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/kopi-sentosa"
      />,
    );
    expect(screen.getAllByText("Habis").length).toBeGreaterThan(0);
  });

  it("shows stock and expiry facts for an available listing", () => {
    render(
      <PublicOfferContent
        listing={expiringSoonListingFixture}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/toko-berkah"
      />,
    );
    expect(screen.getByText("12 tersisa")).toBeInTheDocument();
  });
});
