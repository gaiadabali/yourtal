import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
  soldOutListingFixture,
} from "@yourtal/contracts/listing/mock";
import { mixedStateBalanceFixture, zeroBalanceFixture } from "@yourtal/contracts/balance/mock";
import { StoreOfferCard } from "./store-offer-card";

describe("StoreOfferCard (id-ID)", () => {
  it("renders the terms before the primary action, so terms are never reachable only after acting", () => {
    render(
      <StoreOfferCard
        listing={expiringSoonListingFixture}
        balance={mixedStateBalanceFixture}
        locale="id-ID"
      />,
    );
    const bodyText = document.body.textContent ?? "";
    const termsIndex = bodyText.indexOf("Ketentuan");
    const actionIndex = bodyText.indexOf("Tukar Sekarang");
    expect(termsIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(-1);
    expect(termsIndex).toBeLessThan(actionIndex);
  });

  it("disables the primary action and explains why when sold out", () => {
    render(
      <StoreOfferCard
        listing={soldOutListingFixture}
        balance={mixedStateBalanceFixture}
        locale="id-ID"
      />,
    );
    expect(screen.getByRole("button", { name: /stok habis/i })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /tukar sekarang/i })).not.toBeInTheDocument();
  });

  it("disables the primary action and shows the shortfall when the balance is insufficient", () => {
    render(
      <StoreOfferCard
        listing={abovePlausibleBalanceListingFixture}
        balance={zeroBalanceFixture}
        locale="id-ID"
      />,
    );
    expect(screen.getByRole("button", { name: /poin belum cukup/i })).toBeDisabled();
    expect(screen.getByText(/kurang 1\.500\.000 poin lagi/i)).toBeInTheDocument();
  });

  it("links the primary action to the redeem route when affordable and in stock", () => {
    render(
      <StoreOfferCard
        listing={expiringSoonListingFixture}
        balance={mixedStateBalanceFixture}
        locale="id-ID"
      />,
    );
    expect(screen.getByRole("link", { name: /tukar sekarang/i })).toHaveAttribute(
      "href",
      `/store/${expiringSoonListingFixture.id}/redeem`,
    );
  });
});

describe("StoreOfferCard (en-AU, YT-0405)", () => {
  it("renders every label in English, with no Indonesian copy leaking through", () => {
    const { container } = render(
      <StoreOfferCard
        listing={expiringSoonListingFixture}
        balance={mixedStateBalanceFixture}
        locale="en-AU"
      />,
    );
    expect(screen.getByText("Terms")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /redeem now/i })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /Ketentuan|Tukar Sekarang|Kategori|Lokasi|Stok|Berlaku hingga/,
    );
  });

  it("disables the primary action with English copy when sold out", () => {
    render(
      <StoreOfferCard
        listing={soldOutListingFixture}
        balance={mixedStateBalanceFixture}
        locale="en-AU"
      />,
    );
    expect(screen.getByRole("button", { name: /sold out/i })).toBeDisabled();
  });
});
