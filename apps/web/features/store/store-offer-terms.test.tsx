import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { rupiah, toIdrMinorUnits } from "@yourtal/contracts/money";
import { StoreOfferTerms } from "./store-offer-terms";

describe("StoreOfferTerms", () => {
  it("shows the minimum spend amount for a minimum_spend policy", () => {
    render(
      <StoreOfferTerms
        partialRedemptionPolicy="minimum_spend"
        minimumSpendIdr={rupiah(100_000)}
        transferable={false}
      />,
    );
    expect(screen.getByText(/100\.000/)).toBeInTheDocument();
  });

  it("states transferability plainly", () => {
    render(
      <StoreOfferTerms
        partialRedemptionPolicy="balance_carrying"
        minimumSpendIdr={null}
        transferable
      />,
    );
    expect(screen.getByText(/satu pengguna/i)).toBeInTheDocument();
  });

  it("names the policy label so the terms are identifiable at a glance", () => {
    render(
      <StoreOfferTerms
        partialRedemptionPolicy="single_use_forfeit"
        minimumSpendIdr={null}
        transferable={false}
      />,
    );
    expect(screen.getByText("Sekali pakai, sisa hangus")).toBeInTheDocument();
  });
});
