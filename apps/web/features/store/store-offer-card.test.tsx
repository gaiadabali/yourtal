import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { abovePlausibleBalanceListingFixture, expiringSoonListingFixture, soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import { mixedStateBalanceFixture, zeroBalanceFixture } from "@yourtal/contracts/balance/mock";
import { StoreOfferCard } from "./store-offer-card";

describe("StoreOfferCard", () => {
  it("renders the terms before the primary action, so terms are never reachable only after acting", () => {
    render(<StoreOfferCard listing={expiringSoonListingFixture} balance={mixedStateBalanceFixture} />);
    const bodyText = document.body.textContent ?? "";
    const termsIndex = bodyText.indexOf("Ketentuan");
    const actionIndex = bodyText.indexOf("Tukar Sekarang");
    expect(termsIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(-1);
    expect(termsIndex).toBeLessThan(actionIndex);
  });

  it("disables the primary action and explains why when sold out", () => {
    render(<StoreOfferCard listing={soldOutListingFixture} balance={mixedStateBalanceFixture} />);
    expect(screen.getByRole("button", { name: /stok habis/i })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /tukar sekarang/i })).not.toBeInTheDocument();
  });

  it("disables the primary action and shows the shortfall when the balance is insufficient", () => {
    render(<StoreOfferCard listing={abovePlausibleBalanceListingFixture} balance={zeroBalanceFixture} />);
    expect(screen.getByRole("button", { name: /poin belum cukup/i })).toBeDisabled();
    expect(screen.getByText(/kurang 1\.500\.000 poin lagi/i)).toBeInTheDocument();
  });

  it("links the primary action to the redeem route when affordable and in stock", () => {
    render(<StoreOfferCard listing={expiringSoonListingFixture} balance={mixedStateBalanceFixture} />);
    expect(screen.getByRole("link", { name: /tukar sekarang/i })).toHaveAttribute(
      "href",
      `/store/${expiringSoonListingFixture.id}/redeem`,
    );
  });
});
