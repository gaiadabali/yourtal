import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { expiringSoonListingFixture, soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import { StoreListingCard } from "./store-listing-card";

describe("StoreListingCard", () => {
  it("links the title to the offer detail page", () => {
    render(<StoreListingCard listing={soldOutListingFixture} />);
    expect(screen.getByRole("link", { name: soldOutListingFixture.title })).toHaveAttribute(
      "href",
      `/store/${soldOutListingFixture.id}`,
    );
  });

  it("shows the points price and the face value beside it", () => {
    render(<StoreListingCard listing={soldOutListingFixture} />);
    expect(screen.getByText(/poin/)).toBeInTheDocument();
    expect(screen.getByText(/Senilai Rp/)).toBeInTheDocument();
  });

  it("badges a sold-out listing", () => {
    render(<StoreListingCard listing={soldOutListingFixture} />);
    expect(screen.getByText("Habis")).toBeInTheDocument();
  });

  it("badges an expiring-soon listing", () => {
    render(<StoreListingCard listing={expiringSoonListingFixture} />);
    expect(screen.getByText("Segera berakhir")).toBeInTheDocument();
  });
});
