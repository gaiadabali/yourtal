import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { expiringSoonListingFixture, soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import { StoreListingCard } from "./store-listing-card";

// A listing's currency is its own field (YT-0513), never a prop the caller
// sets independently — the AU variants below are the IDR fixtures with
// `currency` swapped to AUD.
const auSoldOutListingFixture = { ...soldOutListingFixture, currency: "AUD" as const };
const auExpiringSoonListingFixture = { ...expiringSoonListingFixture, currency: "AUD" as const };

describe("StoreListingCard (id-ID)", () => {
  it("links the title to the offer detail page", () => {
    render(<StoreListingCard listing={soldOutListingFixture} locale="id-ID" />);
    expect(screen.getByRole("link", { name: soldOutListingFixture.title })).toHaveAttribute(
      "href",
      `/store/${soldOutListingFixture.id}`,
    );
  });

  it("shows the points price and the face value beside it", () => {
    render(<StoreListingCard listing={soldOutListingFixture} locale="id-ID" />);
    expect(screen.getByText(/poin/)).toBeInTheDocument();
    expect(screen.getByText(/Senilai Rp/)).toBeInTheDocument();
  });

  it("badges a sold-out listing", () => {
    render(<StoreListingCard listing={soldOutListingFixture} locale="id-ID" />);
    expect(screen.getByText("Habis")).toBeInTheDocument();
  });

  it("badges an expiring-soon listing", () => {
    render(<StoreListingCard listing={expiringSoonListingFixture} locale="id-ID" />);
    expect(screen.getByText("Segera berakhir")).toBeInTheDocument();
  });
});

describe("StoreListingCard (en-AU, YT-0405)", () => {
  it("shows the points price and face value in AUD, with no Indonesian copy leaking through", () => {
    const { container } = render(
      <StoreListingCard listing={auSoldOutListingFixture} locale="en-AU" />,
    );
    expect(screen.getByText(/points/)).toBeInTheDocument();
    expect(screen.getByText(/Worth \$/)).toBeInTheDocument();
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bpoin\b|Senilai|Habis/i);
  });

  it("badges an expiring-soon listing in English", () => {
    render(<StoreListingCard listing={auExpiringSoonListingFixture} locale="en-AU" />);
    expect(screen.getByText("Expiring soon")).toBeInTheDocument();
  });
});
