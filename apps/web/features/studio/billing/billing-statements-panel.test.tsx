import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { billingStatementSchema } from "@yourtal/contracts/billing";
import type { BillingStatement } from "@yourtal/contracts/billing";
import { BillingStatementsPanel } from "./billing-statements-panel";

function statement(overrides: Partial<BillingStatement> = {}): BillingStatement {
  return billingStatementSchema.parse({
    id: "st-1",
    region: "AU",
    currency: "AUD",
    periodFrom: "2026-10-12T00:00:00.000Z",
    periodTo: "2026-10-19T00:00:00.000Z",
    openingPayableMinor: 1_000,
    capturesMinor: 5_000,
    refundsMinor: 500,
    recoveriesMinor: 0,
    closingPayableMinor: 5_500,
    pointPurchasesPoints: 0,
    status: "open",
    disputeReason: null,
    disputeWindowEndsAt: "2026-10-26T00:00:00.000Z",
    generatedAt: "2026-10-19T01:00:00.000Z",
    payoutTransferId: null,
    ...overrides,
  });
}

describe("BillingStatementsPanel", () => {
  it("gives each statement row a status badge and a details view with its figures and what its status means", () => {
    render(
      <BillingStatementsPanel statements={[statement()]} payouts={[]} locale="en-AU" region="AU" />,
    );
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("Details")).toBeInTheDocument();
    expect(within(row).getByText("Carried over from the last statement")).toBeInTheDocument();
    expect(within(row).getByText("Vouchers redeemed at your locations")).toBeInTheDocument();
    expect(within(row).getByText("Payable to you")).toBeInTheDocument();
    expect(within(row).getByText(/the dispute window runs until 26 Oct 2026/)).toBeInTheDocument();
  });

  it("shows the reason on a disputed statement", () => {
    render(
      <BillingStatementsPanel
        statements={[statement({ status: "disputed", disputeReason: "Count is off" })]}
        payouts={[]}
        locale="en-AU"
        region="AU"
      />,
    );
    expect(screen.getByText("Reason given: Count is off")).toBeInTheDocument();
  });
});
