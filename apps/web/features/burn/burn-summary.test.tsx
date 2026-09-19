import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { Region } from "@yourtal/contracts/region";
import { toIdrMinorUnits } from "@yourtal/contracts/money";
import { RegionProvider } from "@/features/region/region-context";
import { regionDisplayConfig } from "@/features/region/region-config";
import enAU from "@/messages/en-AU/burn.json";
import idID from "@/messages/id-ID/burn.json";
import { BurnSummary } from "./burn-summary";
import { makeListingFixture } from "./burn-test-fixtures";

/** See `burn-error-message.test.tsx` for why `BurnSummary` (a Client Component, YT-0405) needs both providers. */
function renderWithRegion(ui: ReactElement, region: Region = "ID") {
  const { locale } = regionDisplayConfig(region);
  const messages = { burn: region === "AU" ? enAU : idID };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <RegionProvider region={region}>{ui}</RegionProvider>
    </NextIntlClientProvider>,
  );
}

describe("BurnSummary", () => {
  it("restates the points cost, the face value and what the user gets", () => {
    const listing = makeListingFixture({
      merchantName: "Kopi Sentosa",
      title: "Voucher Kopi Rp30.000",
    });
    renderWithRegion(<BurnSummary listing={listing} />);

    expect(screen.getByText("Voucher Kopi Rp30.000")).toBeInTheDocument();
    expect(screen.getByText("5.000 poin")).toBeInTheDocument();
    expect(screen.getByText(/Rp.?100\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Voucher Kopi Sentosa/)).toBeInTheDocument();
  });

  it("shows the confirmation heading and the same figures when used as the confirmation step", () => {
    const listing = makeListingFixture();
    renderWithRegion(<BurnSummary listing={listing} variant="confirmation" />);
    expect(screen.getByRole("heading", { name: "Konfirmasi penukaran" })).toBeInTheDocument();
    expect(screen.getByText("5.000 poin")).toBeInTheDocument();
  });

  it("shows the minimum spend only when the policy requires one", () => {
    const withMinimum = makeListingFixture({
      partialRedemptionPolicy: "minimum_spend",
      minimumSpendIdr: toIdrMinorUnits(50_000),
    });
    renderWithRegion(<BurnSummary listing={withMinimum} />);
    expect(screen.getByText("Minimum belanja")).toBeInTheDocument();
    expect(screen.getByText(/Rp.?50\.000/)).toBeInTheDocument();
  });

  it("omits the minimum-spend row entirely for a non-minimum-spend policy", () => {
    const listing = makeListingFixture({
      partialRedemptionPolicy: "single_use_forfeit",
      minimumSpendIdr: null,
    });
    renderWithRegion(<BurnSummary listing={listing} />);
    expect(screen.queryByText("Minimum belanja")).not.toBeInTheDocument();
  });

  it("states plainly that a non-transferable voucher cannot be passed on", () => {
    const listing = makeListingFixture({ transferable: false });
    renderWithRegion(<BurnSummary listing={listing} />);
    expect(screen.getByText(/tidak dapat dialihkan/)).toBeInTheDocument();
  });
});

describe("BurnSummary (en-AU, YT-0405)", () => {
  it("restates the points cost and face value in AUD, never a hardcoded Rp", () => {
    const listing = makeListingFixture({ merchantName: "Sydney Coffee Co" });
    renderWithRegion(<BurnSummary listing={listing} />, "AU");

    expect(screen.getByText(/points$/)).toBeInTheDocument();
    expect(screen.getByText(/^\$/)).toBeInTheDocument();
    expect(screen.queryByText(/Rp|\bpoin\b/)).not.toBeInTheDocument();
  });

  it("shows the confirmation heading in English", () => {
    const listing = makeListingFixture();
    renderWithRegion(<BurnSummary listing={listing} variant="confirmation" />, "AU");
    expect(screen.getByRole("heading", { name: "Confirm redemption" })).toBeInTheDocument();
  });

  it("states minimum spend in AUD and transferability in English", () => {
    const withMinimum = makeListingFixture({
      partialRedemptionPolicy: "minimum_spend",
      minimumSpendIdr: toIdrMinorUnits(5_000),
      transferable: false,
    });
    renderWithRegion(<BurnSummary listing={withMinimum} />, "AU");
    expect(screen.getByText("Minimum spend")).toBeInTheDocument();
    expect(screen.getByText(/cannot be transferred/)).toBeInTheDocument();
  });
});
