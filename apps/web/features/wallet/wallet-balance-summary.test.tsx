import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { mixedStateBalanceFixture, zeroBalanceFixture } from "@yourtal/contracts/balance/mock";
import { WalletBalanceSummary } from "./wallet-balance-summary";

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

describe("WalletBalanceSummary", () => {
  it("shows available balance, pending-with-unlock-date and expiring-soon-with-date all at once", () => {
    render(<WalletBalanceSummary balance={mixedStateBalanceFixture} nowMs={nowMs} />);

    expect(screen.getByText(/8\.400 poin/)).toBeInTheDocument();
    expect(screen.getByText(/1\.200 poin/)).toBeInTheDocument();
    expect(screen.getByText(/500 poin/)).toBeInTheDocument();
    // Both the pending and expiring rows must show *when*, not just how much.
    expect(screen.getAllByText(/cair|kedaluwarsa/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/hari/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders the zero-balance fixture plainly, without a pending or expiring date it does not have", () => {
    render(<WalletBalanceSummary balance={zeroBalanceFixture} nowMs={nowMs} />);

    expect(screen.getByText("0 poin")).toBeInTheDocument();
    expect(screen.getByText("Tidak ada poin tertahan")).toBeInTheDocument();
    expect(screen.getByText("Tidak ada poin yang akan hangus")).toBeInTheDocument();
  });
});

describe("WalletBalanceSummary (en-AU, YT-0405)", () => {
  it("shows available, pending and expiring balances in English with their unlock/expiry dates", () => {
    render(
      <WalletBalanceSummary balance={mixedStateBalanceFixture} nowMs={nowMs} locale="en-AU" />,
    );

    expect(screen.getByText(/8,400 points/)).toBeInTheDocument();
    expect(screen.getAllByText(/unlocks|expires/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/days?/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders the zero-balance fixture in English, with no Indonesian copy leaking through", () => {
    render(<WalletBalanceSummary balance={zeroBalanceFixture} nowMs={nowMs} locale="en-AU" />);

    expect(screen.getByText("0 points")).toBeInTheDocument();
    expect(screen.getByText("No points on hold")).toBeInTheDocument();
    expect(screen.getByText("No points expiring soon")).toBeInTheDocument();
  });
});
