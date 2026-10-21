import type { PointPackage, ReceiptProgrammeView } from "@yourtal/contracts/billing";
import type { Currency } from "@yourtal/contracts/money/currency";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";

/**
 * Fixture-only copy of the launch catalogue (AU: A$45.00 per 1,000 points
 * ex-GST, 5% and 10% off the bigger packages; ID: Rp 9.000 and no tax). The
 * real `GET .../billing/packages` is what this stands in for, so the page
 * renders without the API; the server prices every real purchase.
 */
type Row = readonly [
  tierKey: string,
  points: number,
  discountBps: number,
  subtotalMinor: number,
  taxMinor: number,
  pricePer1000Minor: number,
  savingMinor: number,
];

const ROWS: Record<Currency, readonly Row[]> = {
  AUD: [
    ["starter", 1_000, 0, 4_500, 450, 4_500, 0],
    ["grow", 10_000, 500, 42_750, 4_275, 4_275, 2_250],
    ["scale", 50_000, 1_000, 202_500, 20_250, 4_050, 22_500],
  ],
  IDR: [
    ["starter", 1_000, 0, 9_000, 0, 9_000, 0],
    ["grow", 10_000, 500, 85_500, 0, 8_550, 4_500],
    ["scale", 50_000, 1_000, 405_000, 0, 8_100, 45_000],
  ],
};

/** F118: the same GST rates the region settings seed. */
const TAX_RATE_BPS: Record<Currency, number> = { AUD: 1_000, IDR: 0 };

export function mockPackages(currency: Currency): PointPackage[] {
  return ROWS[currency].map(([tierKey, points, discountBps, subtotal, tax, per1000, saving]) => ({
    tierKey,
    points: toPoints(points),
    discountBps,
    subtotalMinor: toMinorUnits(subtotal),
    taxMinor: toMinorUnits(tax),
    totalMinor: toMinorUnits(subtotal + tax),
    taxRateBps: TAX_RATE_BPS[currency],
    currency,
    pricePer1000Minor: toMinorUnits(per1000),
    savingMinor: toMinorUnits(saving),
    pricing: "tier" as const,
  }));
}

/**
 * Fixture-only receipt package catalogue and programme view (docs/27: A$30
 * / A$300 / A$1,500 ex-GST, IDR 6,000 / 60,000 / 300,000, no discount). The
 * mock Billing source answers "not a funder"; tests and screenshots build a
 * funder from this.
 */
const RECEIPT_ROWS: Record<Currency, readonly (readonly [string, number, number, number])[]> = {
  AUD: [
    ["starter", 1_000, 3_000, 300],
    ["grow", 10_000, 30_000, 3_000],
    ["scale", 50_000, 150_000, 15_000],
  ],
  IDR: [
    ["starter", 1_000, 6_000, 0],
    ["grow", 10_000, 60_000, 0],
    ["scale", 50_000, 300_000, 0],
  ],
};

export function mockReceiptProgramme(
  currency: Currency,
  over: { earning?: boolean; remainingPoints?: number } = {},
): ReceiptProgrammeView {
  const earning = over.earning ?? true;
  const pointsPerReceipt = currency === "AUD" ? 1 : 10;
  return {
    partners: ["snap-app"],
    pointsPerReceipt: toPoints(pointsPerReceipt),
    earning,
    remainingPoints: toPoints(over.remainingPoints ?? (earning ? 412 : 0)),
    packages: RECEIPT_ROWS[currency].map(([tierKey, points, subtotal, tax]) => ({
      tierKey,
      points: toPoints(points),
      discountBps: 0,
      subtotalMinor: toMinorUnits(subtotal),
      taxMinor: toMinorUnits(tax),
      totalMinor: toMinorUnits(subtotal + tax),
      taxRateBps: TAX_RATE_BPS[currency],
      currency,
      pricePer1000Minor: toMinorUnits((subtotal * 1_000) / points),
      savingMinor: toMinorUnits(0),
      pricing: "at_cost" as const,
    })),
  };
}
