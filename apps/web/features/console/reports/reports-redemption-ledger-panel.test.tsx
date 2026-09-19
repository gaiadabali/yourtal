import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { asDisplayIdr } from "@yourtal/contracts/money/format";
import { ReportsRedemptionLedgerPanel } from "./reports-redemption-ledger-panel";
import type { RedemptionLedgerSummary } from "./reports-metrics";

const SUMMARY: RedemptionLedgerSummary = {
  totalVoucherCount: 3,
  rows: [
    {
      status: "redeemed",
      label: "Redeemed",
      count: 2,
      totalFaceValueIdr: asDisplayIdr(80_000),
      provenance: "measured",
    },
    {
      status: "active",
      label: "Active",
      count: 1,
      totalFaceValueIdr: asDisplayIdr(20_000),
      provenance: "measured",
    },
    {
      status: "expired",
      label: "Expired",
      count: 0,
      totalFaceValueIdr: asDisplayIdr(0),
      provenance: "measured",
    },
    {
      status: "transferred",
      label: "Transferred",
      count: 0,
      totalFaceValueIdr: asDisplayIdr(0),
      provenance: "measured",
    },
  ],
};

describe("ReportsRedemptionLedgerPanel", () => {
  it("shows count and formatted total face value per non-zero status, labelled 'Measured'", () => {
    render(<ReportsRedemptionLedgerPanel summary={SUMMARY} currency="IDR" />);
    expect(screen.getByRole("heading", { name: "Redemption ledger" })).toBeInTheDocument();
    expect(screen.getByText("Measured")).toBeInTheDocument();
    expect(screen.getByText(/^Rp\s?80\.000$/)).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("renders AUD via formatMoney when the viewer's region is Australia, never a hardcoded Rp", () => {
    render(<ReportsRedemptionLedgerPanel summary={SUMMARY} currency="AUD" />);
    expect(screen.getByText(/^\$800\.00$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Rp/)).not.toBeInTheDocument();
  });

  it("states plainly that this ledger is not attributed to a source campaign", () => {
    render(<ReportsRedemptionLedgerPanel summary={SUMMARY} currency="IDR" />);
    expect(screen.getByText(/not attributed to a source campaign/i)).toBeInTheDocument();
  });

  it("shows an honest empty state when no vouchers have been issued", () => {
    render(
      <ReportsRedemptionLedgerPanel
        summary={{ totalVoucherCount: 0, rows: SUMMARY.rows.map((row) => ({ ...row, count: 0 })) }}
        currency="IDR"
      />,
    );
    expect(
      screen.getByText("No vouchers have been issued against this business yet."),
    ).toBeInTheDocument();
  });
});
