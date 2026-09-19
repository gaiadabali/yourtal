import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toIdrMinorUnits } from "@yourtal/contracts/money";
import { BurnSummary } from "./burn-summary";
import { makeListingFixture } from "./burn-test-fixtures";

describe("BurnSummary", () => {
  it("restates the points cost, the face value and what the user gets", () => {
    const listing = makeListingFixture({ merchantName: "Kopi Sentosa", title: "Voucher Kopi Rp30.000" });
    render(<BurnSummary listing={listing} />);

    expect(screen.getByText("Voucher Kopi Rp30.000")).toBeInTheDocument();
    expect(screen.getByText("5.000 poin")).toBeInTheDocument();
    expect(screen.getByText(/Rp.?100\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Voucher Kopi Sentosa/)).toBeInTheDocument();
  });

  it("shows the confirmation heading and the same figures when used as the confirmation step", () => {
    const listing = makeListingFixture();
    render(<BurnSummary listing={listing} variant="confirmation" />);
    expect(screen.getByRole("heading", { name: "Konfirmasi penukaran" })).toBeInTheDocument();
    expect(screen.getByText("5.000 poin")).toBeInTheDocument();
  });

  it("shows the minimum spend only when the policy requires one", () => {
    const withMinimum = makeListingFixture({
      partialRedemptionPolicy: "minimum_spend",
      minimumSpendIdr: toIdrMinorUnits(50_000),
    });
    render(<BurnSummary listing={withMinimum} />);
    expect(screen.getByText("Minimum belanja")).toBeInTheDocument();
    expect(screen.getByText(/Rp.?50\.000/)).toBeInTheDocument();
  });

  it("omits the minimum-spend row entirely for a non-minimum-spend policy", () => {
    const listing = makeListingFixture({ partialRedemptionPolicy: "single_use_forfeit", minimumSpendIdr: null });
    render(<BurnSummary listing={listing} />);
    expect(screen.queryByText("Minimum belanja")).not.toBeInTheDocument();
  });

  it("states plainly that a non-transferable voucher cannot be passed on", () => {
    const listing = makeListingFixture({ transferable: false });
    render(<BurnSummary listing={listing} />);
    expect(screen.getByText(/tidak dapat dialihkan/)).toBeInTheDocument();
  });
});
