import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { StudioRedemptionEntry } from "@yourtal/contracts/device/studio-redemptions";
import { RedemptionsScreen } from "./redemptions-screen";

const entry = (over: Partial<StudioRedemptionEntry> = {}): StudioRedemptionEntry => ({
  captureId: "cap-1",
  deviceId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  deviceLabel: "Front counter",
  locationId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b11",
  locationName: "Kebayoran",
  voucherId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b12",
  amountMinor: toMinorUnits(4_500),
  currency: "AUD",
  orderRef: "ORD-1",
  // 14:30 UTC on 20 Oct is 01:30 on the 21st in Sydney and 21:30 on the 20th in Jakarta.
  capturedAt: "2026-10-20T14:30:00.000Z",
  ...over,
});

describe("RedemptionsScreen", () => {
  it("writes amounts in the viewer's language, in the capture's own currency", () => {
    render(<RedemptionsScreen entries={[entry()]} locale="id-ID" />);
    // The total and the row.
    expect(screen.getAllByText("AU$45,00").length).toBeGreaterThanOrEqual(2);
  });

  it("writes Rupiah in English the English way, and dollars with a dollar sign", () => {
    const { unmount } = render(
      <RedemptionsScreen
        entries={[entry({ currency: "IDR", amountMinor: toMinorUnits(80_000) })]}
        locale="en-AU"
      />,
    );
    expect(screen.getAllByText(/^IDR\s80,000$/).length).toBeGreaterThanOrEqual(2);
    unmount();
    render(<RedemptionsScreen entries={[entry()]} locale="en-AU" />);
    expect(screen.getAllByText("$45.00").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the capture time in the counter's zone, not the server's", () => {
    render(<RedemptionsScreen entries={[entry()]} locale="en-AU" />);
    expect(screen.getAllByText("21 Oct 2026, 1:30 am").length).toBeGreaterThan(0);
  });
});
