import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletHistoryList } from "./wallet-history-list";
import type { WalletHistoryEntry } from "./wallet-history";

const entries: WalletHistoryEntry[] = [
  {
    id: "earn-1",
    occurredAt: "2026-09-18T09:00:00.000Z",
    description: "Menyelesaikan video Kopi Kenangan — dapat 2.400 poin",
    pointsDelta: 2_400,
  },
  {
    id: "spend-1",
    occurredAt: "2026-09-17T09:00:00.000Z",
    description: "Ditukar 3.000 poin untuk voucher Toko Berkah",
    pointsDelta: -3_000,
  },
];

describe("WalletHistoryList", () => {
  it("renders each entry's plain-language description, never a transaction code", () => {
    render(<WalletHistoryList entries={entries} locale="id-ID" />);

    expect(
      screen.getByText("Menyelesaikan video Kopi Kenangan — dapat 2.400 poin"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ditukar 3.000 poin untuk voucher Toko Berkah")).toBeInTheDocument();
    expect(screen.queryByText(/TXN|CODE_/)).not.toBeInTheDocument();
  });

  it("shows a positive sign for earned points and a negative sign for spent points", () => {
    render(<WalletHistoryList entries={entries} locale="id-ID" />);

    expect(screen.getByText("+2.400")).toBeInTheDocument();
    expect(screen.getByText("-3.000")).toBeInTheDocument();
  });

  it("shows a plain message instead of an empty list when there is no history yet", () => {
    render(<WalletHistoryList entries={[]} locale="id-ID" />);

    expect(screen.getByText(/Belum ada riwayat/)).toBeInTheDocument();
  });

  it("formats the signed amount with en-AU grouping when locale='en-AU' (YT-0405)", () => {
    render(<WalletHistoryList entries={entries} locale="en-AU" />);

    expect(screen.getByText("+2,400")).toBeInTheDocument();
    expect(screen.getByText("-3,000")).toBeInTheDocument();
  });

  it("shows the empty-state message in English for locale='en-AU' (YT-0405)", () => {
    render(<WalletHistoryList entries={[]} locale="en-AU" />);

    expect(screen.getByText("No point history yet.")).toBeInTheDocument();
  });
});
