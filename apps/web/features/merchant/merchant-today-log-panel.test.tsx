import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CounterLogEntry } from "@yourtal/contracts/device/counter-redemption";
import { toMinorUnits } from "@yourtal/contracts/money";
import { getMerchantCopy } from "./merchant-i18n";
import { MerchantTodayLogPanel } from "./merchant-today-log-panel";

const copy = getMerchantCopy("en-AU");

function makeEntry(overrides: Partial<CounterLogEntry> = {}): CounterLogEntry {
  return {
    captureId: "rcpt_1",
    voucherId: "00000000-0000-4000-8000-000000000001",
    amountMinor: toMinorUnits(10_000),
    currency: "AUD",
    capturedAt: "2026-09-19T09:00:00.000Z",
    orderRef: "ord_437ae7fe-ecb2-48e3-ad1a-e0f8a8d072e9",
    authorizedAt: "2026-09-19T08:59:00.000Z",
    offerTitle: "Free coffee",
    ...overrides,
  };
}

function renderPanel(entries: CounterLogEntry[], locale: "en-AU" | "id-ID" = "en-AU") {
  render(
    <MerchantTodayLogPanel
      entries={entries}
      locale={locale}
      currency={locale === "id-ID" ? "IDR" : "AUD"}
      region={locale === "id-ID" ? "ID" : "AU"}
      copy={getMerchantCopy(locale)}
    />,
  );
}

describe("MerchantTodayLogPanel", () => {
  it("shows the empty state when there are no entries", () => {
    renderPanel([]);
    expect(screen.getByText(copy.todayEmpty)).toBeInTheDocument();
  });

  it("totals an empty Indonesian log in rupiah, not dollars", () => {
    renderPanel([], "id-ID");
    expect(screen.getByText(/^Rp\s0$/u)).toBeInTheDocument();
    expect(screen.queryByText(/\$/u)).not.toBeInTheDocument();
  });

  it("sums every entry's amount into the running total — every entry here IS confirmed, since the server only ever logs a real capture", () => {
    // 1_000 + 2_000 cents sums to a $30.00 total distinct from either row's own amount.
    renderPanel([
      makeEntry({ captureId: "a", amountMinor: toMinorUnits(1_000) }),
      makeEntry({ captureId: "b", amountMinor: toMinorUnits(2_000) }),
    ]);
    expect(screen.getByText("$30.00")).toBeInTheDocument();
  });

  it("names each redemption by its voucher, with its amount and time, and never shows the order id", () => {
    renderPanel([makeEntry({ capturedAt: "2026-09-19T09:00:00.000Z" })]);
    expect(screen.getByText("Free coffee")).toBeInTheDocument();
    expect(screen.getAllByText("$100.00").length).toBeGreaterThan(0);
    // 09:00 UTC is 7:00 pm in Sydney (AEST, +10).
    expect(screen.getByText(/^7:00\s?pm$/iu)).toBeInTheDocument();
    expect(screen.queryByText(/ord_/u)).not.toBeInTheDocument();
  });

  it("calls a row logged before titles were kept a plain voucher, never an id", () => {
    renderPanel([makeEntry({ offerTitle: null })]);
    expect(screen.getByText(copy.todayUnnamedVoucher)).toBeInTheDocument();
    expect(screen.queryByText(/ord_/u)).not.toBeInTheDocument();
  });

  it("sorts newest capture first", () => {
    renderPanel([
      makeEntry({ captureId: "older", offerTitle: "OLD", capturedAt: "2026-09-19T08:00:00.000Z" }),
      makeEntry({ captureId: "newer", offerTitle: "NEW", capturedAt: "2026-09-19T09:00:00.000Z" }),
    ]);
    const rows = screen.getAllByText(/OLD|NEW/);
    expect(rows[0]).toHaveTextContent("NEW");
  });
});
