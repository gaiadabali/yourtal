import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  asDisplayIdr,
  asDisplayPoints,
  formatMoney,
  formatPoints,
} from "@yourtal/contracts/money/format";
import type { Region } from "@yourtal/contracts/region";
import { RegionProvider } from "./region-context";
import { useRegion } from "./use-region";

// A stand-in for a real screen: it reads `useRegion()` exactly once and
// derives currency, number formatting AND copy (the points word) from that
// one value — which is the property YT-0405 acceptance criterion 5 needs
// proven: these three cannot drift apart because nothing here can set them
// independently.
// A raw minor-unit integer, deliberately NOT tied to a currency: the whole
// point of this test is that the same stored value renders as $45.50 under
// AU and Rp 45,5 under ID, decided only by what `useRegion()` returns. Since
// YT-0506 made IDR two-decimal as well, both sides now scale by 100 — which
// is why the digits agree and only the symbol and separators differ.
const SAMPLE_PRICE = asDisplayIdr(4_550);
const SAMPLE_POINTS = asDisplayPoints(2_400);

function PriceCard() {
  const { locale, currency } = useRegion();
  return (
    <p>
      <span data-testid="price">{formatMoney(SAMPLE_PRICE, currency)}</span>
      <span data-testid="points">{formatPoints(SAMPLE_POINTS, locale)}</span>
    </p>
  );
}

function renderPriceCard(region: Region) {
  render(
    <RegionProvider region={region}>
      <PriceCard />
    </RegionProvider>,
  );
}

describe("useRegion() outside a RegionProvider", () => {
  it("throws rather than silently defaulting", () => {
    // Suppress the expected React error-boundary console.error noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<PriceCard />)).toThrow(/RegionProvider/);
    spy.mockRestore();
  });
});

describe("region wiring: currency, number formatting and copy cannot drift apart", () => {
  it("AU renders AUD currency and the English points word together", () => {
    renderPriceCard("AU");
    expect(screen.getByTestId("price").textContent).toContain("$45.50");
    expect(screen.getByTestId("points").textContent).toBe("2,400 points");
  });

  it("ID renders IDR currency and the Indonesian points word together", () => {
    renderPriceCard("ID");
    expect(screen.getByTestId("price").textContent).toContain("Rp");
    expect(screen.getByTestId("price").textContent).toContain("45,5");
    expect(screen.getByTestId("points").textContent).toBe("2.400 poin");
  });

  it("switching the single `region` prop flips currency, grouping and copy together — not three independent toggles", () => {
    const { rerender } = render(
      <RegionProvider region="ID">
        <PriceCard />
      </RegionProvider>,
    );
    const idPrice = screen.getByTestId("price").textContent ?? "";
    const idPoints = screen.getByTestId("points").textContent ?? "";

    rerender(
      <RegionProvider region="AU">
        <PriceCard />
      </RegionProvider>,
    );
    const auPrice = screen.getByTestId("price").textContent ?? "";
    const auPoints = screen.getByTestId("points").textContent ?? "";

    // All three signals moved together off the one prop flip: currency
    // symbol, number grouping and the points word.
    expect(idPrice).toContain("Rp");
    expect(auPrice.startsWith("$")).toBe(true);
    expect(idPoints.endsWith("poin")).toBe(true);
    expect(auPoints.endsWith("points")).toBe(true);
    expect(auPrice).not.toBe(idPrice);
    expect(auPoints).not.toBe(idPoints);
  });
});
