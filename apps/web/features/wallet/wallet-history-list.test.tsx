import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { asDisplayPoints } from "@yourtal/contracts/money/money-format";
import { WalletHistoryList } from "./wallet-history-list";
import { walletTestTranslator } from "./wallet-test-translator";

let locale: "en-AU" | "id-ID" = "id-ID";
vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator(locale),
}));

// The live `GET /api/wallet/history` shape (4.8.a/4.9.d): `kind`/`points`/
// `direction` only, no `description` and no merchant name — the web words
// each entry itself (`wallet-history-copy.ts`).
const entries: WalletHistoryEntry[] = [
  {
    id: "earn-1",
    kind: "earn",
    occurredAt: "2026-09-18T09:00:00.000Z",
    points: asDisplayPoints(2_400),
    direction: "credit",
  },
  {
    id: "burn-1",
    kind: "burn",
    occurredAt: "2026-09-17T09:00:00.000Z",
    points: asDisplayPoints(3_000),
    direction: "debit",
  },
];

describe("WalletHistoryList", () => {
  it("renders each entry's plain-language description, never a transaction code", async () => {
    locale = "id-ID";
    render(await WalletHistoryList({ entries, locale: "id-ID" }));

    expect(screen.getByText("Mendapat 2.400 poin")).toBeInTheDocument();
    expect(screen.getByText("Ditukar 3.000 poin untuk voucher")).toBeInTheDocument();
    expect(screen.queryByText(/TXN|CODE_/)).not.toBeInTheDocument();
  });

  it("shows a positive sign for earned points and a negative sign for spent points", async () => {
    locale = "id-ID";
    render(await WalletHistoryList({ entries, locale: "id-ID" }));

    expect(screen.getByText("+2.400")).toBeInTheDocument();
    expect(screen.getByText("-3.000")).toBeInTheDocument();
  });

  it("shows a plain message instead of an empty list when there is no history yet", async () => {
    locale = "id-ID";
    render(await WalletHistoryList({ entries: [], locale: "id-ID" }));

    expect(screen.getByText(/Belum ada riwayat/)).toBeInTheDocument();
  });

  it("formats the signed amount with en-AU grouping", async () => {
    locale = "en-AU";
    render(await WalletHistoryList({ entries, locale: "en-AU" }));

    expect(screen.getByText("+2,400")).toBeInTheDocument();
    expect(screen.getByText("-3,000")).toBeInTheDocument();
    expect(screen.getByText("Earned 2,400 points")).toBeInTheDocument();
  });

  it("shows the empty-state message in English", async () => {
    locale = "en-AU";
    render(await WalletHistoryList({ entries: [], locale: "en-AU" }));

    expect(screen.getByText("No point history yet.")).toBeInTheDocument();
  });
});
