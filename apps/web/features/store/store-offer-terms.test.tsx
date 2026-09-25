import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { rupiah } from "@yourtal/contracts/money";
import { StoreOfferTerms } from "./store-offer-terms";

describe("StoreOfferTerms (id-ID)", () => {
  it("shows the minimum spend amount for a minimum_spend policy", () => {
    render(
      <StoreOfferTerms
        partialRedemptionPolicy="minimum_spend"
        minimumSpendMinor={rupiah(100_000)}
        transferable={false}
        locale="id-ID"
        currency="IDR"
      />,
    );
    expect(screen.getByText(/100\.000/)).toBeInTheDocument();
  });

  it("states transferability plainly", () => {
    render(
      <StoreOfferTerms
        partialRedemptionPolicy="balance_carrying"
        minimumSpendMinor={null}
        transferable
        locale="id-ID"
        currency="IDR"
      />,
    );
    expect(screen.getByText(/satu pengguna/i)).toBeInTheDocument();
  });

  it("names the policy label so the terms are identifiable at a glance", () => {
    render(
      <StoreOfferTerms
        partialRedemptionPolicy="single_use_forfeit"
        minimumSpendMinor={null}
        transferable={false}
        locale="id-ID"
        currency="IDR"
      />,
    );
    expect(screen.getByText("Sekali pakai, sisa hangus")).toBeInTheDocument();
    expect(screen.getByText("Ketentuan")).toBeInTheDocument();
  });
});

describe("StoreOfferTerms (en-AU, YT-0405)", () => {
  it("shows the minimum spend amount in AUD, with no Indonesian copy leaking through", () => {
    const { container } = render(
      <StoreOfferTerms
        partialRedemptionPolicy="minimum_spend"
        minimumSpendMinor={rupiah(100_000)}
        transferable={false}
        locale="en-AU"
        currency="AUD"
      />,
    );
    expect(screen.getByText("Terms")).toBeInTheDocument();
    expect(container.textContent).toMatch(/\$/);
    expect(container.textContent).not.toMatch(/Ketentuan|Rp\d/);
  });
});
