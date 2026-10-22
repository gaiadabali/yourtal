import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StatementPayout, StudioPayouts } from "@yourtal/contracts/billing/payouts";
import type { BillingStatement } from "@yourtal/contracts/billing";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { BillingPayoutsPanel, PayoutsReturnNotice } from "./billing-payouts-panel";
import { BillingStatementsPanel } from "./billing-statements-panel";

vi.mock("./payouts-action", () => ({ startPayoutLinkAction: vi.fn() }));

type State = "not_started" | "in_progress" | "ready";

const payouts = (
  state: State,
  over: Partial<Pick<StudioPayouts, "payoutFailed" | "waitingForAccount">> = {},
): StudioPayouts => ({
  account: {
    available: true,
    state,
    bankLast4: state === "ready" ? "3456" : null,
    hostedOnboarding: true,
  },
  payoutFailed: over.payoutFailed ?? false,
  waitingForAccount: over.waitingForAccount ?? false,
  payouts: [],
});

const panel = (data: StudioPayouts, canEdit = true) =>
  render(<BillingPayoutsPanel businessId="b1" payouts={data} canEdit={canEdit} locale="en-AU" />);

describe("BillingPayoutsPanel (5.2)", () => {
  it("offers to set up payouts when none are set up", () => {
    panel(payouts("not_started", { waitingForAccount: true }));
    expect(screen.getByRole("button", { name: "Set up payouts" })).toBeInTheDocument();
    expect(
      screen.getByText("Approved statements are paid to the bank account you set up here."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Approved payouts are waiting for your payout details."),
    ).toBeInTheDocument();
  });

  it("offers to finish a setup in progress", () => {
    panel(payouts("in_progress"));
    expect(screen.getByRole("button", { name: "Finish setting up" })).toBeInTheDocument();
  });

  it("shows only the last four of a ready account and offers an update", () => {
    panel(payouts("ready", { waitingForAccount: true }));
    expect(screen.getByText("Payouts go to the account ending ••3456")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update bank details" })).toBeInTheDocument();
    expect(screen.queryByText(/waiting for your payout details/)).not.toBeInTheDocument();
  });

  it("says a payout failed and asks for new details", () => {
    panel(payouts("ready", { payoutFailed: true }));
    expect(
      screen.getByText(
        "A payout to your bank account failed. Update your bank details and we'll pay it again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update bank details" })).toBeInTheDocument();
  });

  it("hides the button from people who cannot edit billing", () => {
    panel(payouts("not_started"), false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is not shown outside Australia", () => {
    const data = payouts("not_started");
    const { container } = panel({ ...data, account: { ...data.account, available: false } });
    expect(container).toBeEmptyDOMElement();
  });

  it("speaks Indonesian", () => {
    render(
      <BillingPayoutsPanel businessId="b1" payouts={payouts("ready")} canEdit locale="id-ID" />,
    );
    expect(
      screen.getByText("Pembayaran dikirim ke rekening berakhiran ••3456"),
    ).toBeInTheDocument();
  });
});

describe("PayoutsReturnNotice", () => {
  it.each([
    ["returned", "in_progress", "Thanks — we're checking your payout details."],
    ["returned", "ready", "Payouts are set up."],
    ["error", "not_started", "The payout details page could not be opened. Try again."],
  ] as const)("%s with a %s account", (outcome, state, text) => {
    render(<PayoutsReturnNotice outcome={outcome} payouts={payouts(state)} locale="en-AU" />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

const statement = (id: string, periodFrom: string): BillingStatement => ({
  id,
  region: "AU",
  currency: "AUD",
  periodFrom,
  periodTo: "2026-10-08T00:00:00.000Z",
  openingPayableMinor: 0,
  capturesMinor: toMinorUnits(0),
  refundsMinor: toMinorUnits(0),
  recoveriesMinor: toMinorUnits(0),
  closingPayableMinor: 12_345,
  pointPurchasesPoints: toPoints(0),
  status: "open",
  disputeReason: null,
  disputeWindowEndsAt: "2026-10-15T00:00:00.000Z",
  generatedAt: "2026-10-08T00:00:00.000Z",
  payoutTransferId: null,
});

const payout = (statementId: string, status: StatementPayout["status"]): StatementPayout => ({
  statementId,
  status,
  amountMinor: toMinorUnits(12_345),
  currency: "AUD",
  bankLast4: "3456",
  paidAt: status === "paid" ? "2026-10-10T02:00:00.000Z" : null,
  failureCode: status === "failed" ? "account_closed" : null,
});

describe("BillingStatementsPanel", () => {
  it("joins each statement to its payout and says nothing without one", () => {
    render(
      <BillingStatementsPanel
        statements={[
          statement("s1", "2026-09-01T00:00:00.000Z"),
          statement("s2", "2026-09-08T00:00:00.000Z"),
          statement("s3", "2026-09-15T00:00:00.000Z"),
          statement("s4", "2026-09-22T00:00:00.000Z"),
          statement("s5", "2026-09-29T00:00:00.000Z"),
        ]}
        payouts={[
          payout("s1", "paid"),
          payout("s2", "awaiting_account"),
          payout("s3", "failed"),
          payout("s4", "transferred"),
        ]}
        locale="en-AU"
        region="AU"
      />,
    );
    expect(screen.getByText(/^Paid to account ••3456 on /)).toBeInTheDocument();
    expect(screen.getByText("Waiting for payout details")).toBeInTheDocument();
    expect(screen.getByText("Payout failed")).toBeInTheDocument();
    expect(screen.getByText("Payout on its way")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("calls a statement the ledger marks paid 'Approved', so it never contradicts a payout that is waiting or failed", () => {
    render(
      <BillingStatementsPanel
        statements={[{ ...statement("s1", "2026-09-01T00:00:00.000Z"), status: "paid" }]}
        payouts={[payout("s1", "failed")]}
        locale="en-AU"
        region="AU"
      />,
    );
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Payout failed")).toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  });

  it("has an empty state", () => {
    render(<BillingStatementsPanel statements={[]} payouts={[]} locale="en-AU" region="AU" />);
    expect(screen.getByText("No statements yet")).toBeInTheDocument();
  });

  it("dates a payout on the business's own day, not UTC's", () => {
    vi.stubEnv("TZ", "UTC");
    // 16:30 UTC on the 10th is the 11th in Sydney.
    const paid = { ...payout("s1", "paid"), paidAt: "2026-10-10T16:30:00.000Z" };
    render(
      <BillingStatementsPanel
        statements={[statement("s1", "2026-09-01T00:00:00.000Z")]}
        payouts={[paid]}
        locale="en-AU"
        region="AU"
      />,
    );
    expect(screen.getByText("Paid to account ••3456 on 11 Oct 2026")).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
