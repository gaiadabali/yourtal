import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CounterLogEntry } from "@yourtal/contracts/device/counter-redemption";
import { getMerchantCopy } from "./merchant-i18n";
import { MerchantTodayLogPanel } from "./merchant-today-log-panel";

const copy = getMerchantCopy("en-AU");

function makeEntry(overrides: Partial<CounterLogEntry> = {}): CounterLogEntry {
  return {
    captureId: "rcpt_1",
    voucherId: "00000000-0000-4000-8000-000000000001",
    amountMinor: 10_000,
    currency: "AUD",
    capturedAt: "2026-09-19T09:00:00.000Z",
    orderRef: "ORDER-1",
    authorizedAt: "2026-09-19T08:59:00.000Z",
    ...overrides,
  };
}

describe("MerchantTodayLogPanel", () => {
  it("shows the empty state when there are no entries", () => {
    render(<MerchantTodayLogPanel entries={[]} locale="en-AU" copy={copy} />);
    expect(screen.getByText(copy.todayEmpty)).toBeInTheDocument();
  });

  it("sums every entry's amount into the running total — every entry here IS confirmed, since the server only ever logs a real capture", () => {
    // AUD amounts are cents (formatMoney divides by 100): 1_000 + 2_000
    // cents sums to a $30.00 total distinct from either entry's own
    // displayed amount, so the assertion below can't accidentally match an
    // individual row instead of the header total.
    const entries = [
      makeEntry({ captureId: "a", amountMinor: 1_000 }),
      makeEntry({ captureId: "b", amountMinor: 2_000 }),
    ];
    render(<MerchantTodayLogPanel entries={entries} locale="en-AU" copy={copy} />);
    expect(screen.getByText("$30.00")).toBeInTheDocument();
  });

  it("lists every order reference present", () => {
    const entries = [
      makeEntry({ captureId: "a", orderRef: "ORDER-A" }),
      makeEntry({ captureId: "b", orderRef: "ORDER-B" }),
    ];
    render(<MerchantTodayLogPanel entries={entries} locale="en-AU" copy={copy} />);
    expect(screen.getByText("ORDER-A")).toBeInTheDocument();
    expect(screen.getByText("ORDER-B")).toBeInTheDocument();
  });

  it("sorts newest capture first", () => {
    const entries = [
      makeEntry({ captureId: "older", orderRef: "OLD", capturedAt: "2026-09-19T08:00:00.000Z" }),
      makeEntry({ captureId: "newer", orderRef: "NEW", capturedAt: "2026-09-19T09:00:00.000Z" }),
    ];
    render(<MerchantTodayLogPanel entries={entries} locale="en-AU" copy={copy} />);
    const rows = screen.getAllByText(/OLD|NEW/);
    expect(rows[0]).toHaveTextContent("NEW");
  });
});
