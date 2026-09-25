import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { asDisplayIdr } from "@yourtal/contracts/money/format";
import { ReportsRedemptionLedgerPanel } from "./reports-redemption-ledger-panel";
import type { RedemptionLedgerSummary } from "./reports-metrics";

function summary(currency: "AUD" | "IDR"): RedemptionLedgerSummary {
  return {
    totalVoucherCount: 3,
    rows: [
      {
        status: "redeemed",
        label: "Redeemed",
        count: 2,
        totalFaceValueMinor: asDisplayIdr(80_000),
        currency,
        provenance: "measured",
      },
      {
        status: "active",
        label: "Active",
        count: 1,
        totalFaceValueMinor: asDisplayIdr(20_000),
        currency,
        provenance: "measured",
      },
      {
        status: "expired",
        label: "Expired",
        count: 0,
        totalFaceValueMinor: asDisplayIdr(0),
        currency,
        provenance: "measured",
      },
      {
        status: "transferred",
        label: "Transferred",
        count: 0,
        totalFaceValueMinor: asDisplayIdr(0),
        currency,
        provenance: "measured",
      },
    ],
  };
}

describe("ReportsRedemptionLedgerPanel", () => {
  it("shows count and formatted total face value per non-zero status, labelled 'Measured'", () => {
    render(<ReportsRedemptionLedgerPanel summary={summary("IDR")} />);
    expect(screen.getByRole("heading", { name: "Redemption ledger" })).toBeInTheDocument();
    expect(screen.getByText("Measured")).toBeInTheDocument();
    // 80_000 minor units in IDR renders Rp 80.000 (IDR is whole Rupiah,
    // exponent 0 — FOUNDER DECISION T-1 — so the minor unit is the display unit).
    expect(screen.getByText(/^Rp\s?80\.000$/)).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("renders AUD via formatMoney using the vouchers' own currency, never a hardcoded Rp", () => {
    render(<ReportsRedemptionLedgerPanel summary={summary("AUD")} />);
    expect(screen.getByText(/^\$800\.00$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Rp/)).not.toBeInTheDocument();
  });

  it("states plainly that this ledger is not attributed to a source campaign", () => {
    render(<ReportsRedemptionLedgerPanel summary={summary("IDR")} />);
    expect(screen.getByText(/not attributed to a source campaign/i)).toBeInTheDocument();
  });

  it("shows an honest empty state when no vouchers have been issued", () => {
    const empty = summary("IDR");
    render(
      <ReportsRedemptionLedgerPanel
        summary={{ totalVoucherCount: 0, rows: empty.rows.map((row) => ({ ...row, count: 0 })) }}
      />,
    );
    expect(
      screen.getByText("No vouchers have been issued against this business yet."),
    ).toBeInTheDocument();
  });
});
