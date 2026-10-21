import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BudgetAlert } from "@yourtal/contracts/billing";
import { toPoints } from "@yourtal/contracts/money";
import { BillingAlertsPanel } from "./billing-alerts-panel";

const alert = (over: Partial<BudgetAlert>): BudgetAlert => ({
  id: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  kind: "package",
  subjectId: "alloc_1",
  campaignTitle: null,
  thresholdPct: 80,
  usedPoints: toPoints(8_000),
  totalPoints: toPoints(10_000),
  programme: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  ...over,
});

describe("BillingAlertsPanel (14.13.b)", () => {
  it("says what package reached what", () => {
    render(<BillingAlertsPanel alerts={[alert({})]} locale="en-AU" />);
    expect(screen.getByText("Budget alerts")).toBeInTheDocument();
    expect(screen.getByText("Package of 10,000 points: 80% used")).toBeInTheDocument();
    expect(screen.getByText(/8,000 of 10,000 points used/)).toBeInTheDocument();
    expect(screen.getByText("20 Oct 2026")).toBeInTheDocument();
  });

  it("says rewards have stopped when a package is fully used", () => {
    render(<BillingAlertsPanel alerts={[alert({ thresholdPct: 100 })]} locale="en-AU" />);
    expect(
      screen.getByText(
        "Package of 10,000 points: 100% used — campaigns funded from it have stopped earning rewards until you buy more points",
      ),
    ).toBeInTheDocument();
  });

  it("names the campaign, and says its rewards have stopped at 100%", () => {
    render(
      <BillingAlertsPanel
        alerts={[
          alert({
            id: "8d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
            kind: "campaign",
            campaignTitle: "Spring launch",
            thresholdPct: 100,
          }),
          alert({
            id: "9d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
            kind: "campaign",
            campaignTitle: "Spring launch",
            thresholdPct: 50,
          }),
        ]}
        locale="en-AU"
      />,
    );
    expect(
      screen.getByText("Campaign “Spring launch”: budget 100% used — rewards have stopped"),
    ).toBeInTheDocument();
    expect(screen.getByText("Campaign “Spring launch”: budget 50% used")).toBeInTheDocument();
  });

  it("shows an empty state when there are none", () => {
    render(<BillingAlertsPanel alerts={[]} locale="en-AU" />);
    expect(screen.getByText("No budget alerts")).toBeInTheDocument();
  });

  it("speaks Indonesian for an Indonesian business", () => {
    render(<BillingAlertsPanel alerts={[alert({})]} locale="id-ID" />);
    expect(screen.getByText("Peringatan anggaran")).toBeInTheDocument();
    expect(screen.getByText("Paket 10.000 poin: 80% terpakai")).toBeInTheDocument();
  });

  it("labels a receipt package's alert and uses receipt wording", () => {
    render(
      <BillingAlertsPanel
        alerts={[alert({ programme: "receipts", thresholdPct: 50 })]}
        locale="en-AU"
      />,
    );
    expect(screen.getByText("Receipt package")).toBeInTheDocument();
    expect(screen.getByText("Receipt package of 10,000 points: 50% used")).toBeInTheDocument();
    expect(screen.queryByText(/campaigns funded from it/)).not.toBeInTheDocument();
  });

  it("says receipt points pause when a receipt package is fully used", () => {
    render(
      <BillingAlertsPanel
        alerts={[alert({ programme: "receipts", thresholdPct: 100 })]}
        locale="en-AU"
      />,
    );
    expect(
      screen.getByText(
        "Receipt package of 10,000 points: 100% used — receipt points pause when no other receipt package has room",
      ),
    ).toBeInTheDocument();
  });

  it("does not label an ordinary package", () => {
    render(<BillingAlertsPanel alerts={[alert({})]} locale="en-AU" />);
    expect(screen.queryByText("Receipt package")).not.toBeInTheDocument();
  });
});
