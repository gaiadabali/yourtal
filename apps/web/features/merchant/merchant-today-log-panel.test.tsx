import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMerchantCopy } from "./merchant-copy";
import { MerchantTodayLogPanel } from "./merchant-today-log-panel";
import type { MerchantLogEntry } from "./merchant-today-log";

const copy = getMerchantCopy("en-AU");

function makeEntry(overrides: Partial<MerchantLogEntry> = {}): MerchantLogEntry {
  return {
    id: "e1",
    voucherId: "v1",
    voucherCode: "ABC12345",
    merchantName: "Toko Berkah",
    amountMinor: 10_000,
    status: "confirmed",
    createdAt: "2026-09-19T09:00:00.000Z",
    confirmedAt: "2026-09-19T09:00:01.000Z",
    failureReason: null,
    ...overrides,
  };
}

describe("MerchantTodayLogPanel", () => {
  it("shows the empty state when there are no entries", () => {
    render(<MerchantTodayLogPanel entries={[]} locale="en-AU" currency="AUD" copy={copy} />);
    expect(screen.getByText(copy.todayEmpty)).toBeInTheDocument();
  });

  it("shows only the confirmed total in the running total, never counting pending or failed", () => {
    // AUD amounts are cents (formatMoney divides by 100): 1_000 + 2_000 cents
    // confirmed sums to a $30.00 total distinct from either entry's own
    // displayed amount, so the assertion below can't accidentally match an
    // individual row instead of the header total.
    const entries = [
      makeEntry({ id: "a", amountMinor: 1_000, status: "confirmed" }),
      makeEntry({ id: "b", amountMinor: 2_000, status: "confirmed" }),
      makeEntry({ id: "c", amountMinor: 999_000, status: "pending" }),
      makeEntry({ id: "d", amountMinor: 999_000, status: "failed" }),
    ];
    render(<MerchantTodayLogPanel entries={entries} locale="en-AU" currency="AUD" copy={copy} />);
    expect(screen.getByText("$30.00")).toBeInTheDocument();
  });

  it("labels a pending entry distinctly from a confirmed one", () => {
    const entries = [makeEntry({ id: "a", status: "pending" })];
    render(<MerchantTodayLogPanel entries={entries} locale="en-AU" currency="AUD" copy={copy} />);
    expect(screen.getByText(copy.todayStatusPending)).toBeInTheDocument();
  });

  it("lists every voucher code present", () => {
    const entries = [
      makeEntry({ id: "a", voucherCode: "AAA11111" }),
      makeEntry({ id: "b", voucherCode: "BBB22222" }),
    ];
    render(<MerchantTodayLogPanel entries={entries} locale="en-AU" currency="AUD" copy={copy} />);
    expect(screen.getByText("AAA11111")).toBeInTheDocument();
    expect(screen.getByText("BBB22222")).toBeInTheDocument();
  });
});
