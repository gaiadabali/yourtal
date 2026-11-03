import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { toPoints } from "@yourtal/contracts/money";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { WalletHistory } from "./wallet-history";
import { walletTestTranslator } from "./wallet-test-translator";

vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator("en-AU"),
}));

const NOW = Date.parse("2026-10-21T10:00:00.000Z");
const VOUCHER = "63425956-e7e3-47c8-bdea-4cfc0f92aafc";

const burn = (id: string, relatedId?: string): WalletHistoryEntry => ({
  id,
  kind: "burn",
  occurredAt: "2026-10-20T01:00:00.000Z",
  points: toPoints(120),
  direction: "debit",
  ...(relatedId === undefined ? {} : { relatedId }),
});

async function show(entries: WalletHistoryEntry[]) {
  render(
    await WalletHistory({
      entries,
      filter: "all",
      filterHref: () => "/wallet",
      olderHref: null,
      region: "AU",
      locale: "en-AU",
      nowMs: NOW,
    }),
  );
}

describe("WalletHistory: where a redemption leads", () => {
  it("links a redemption to the voucher it produced", async () => {
    await show([burn("burn_1", VOUCHER)]);

    expect(screen.getByRole("link", { name: /Redeemed 120 points/ })).toHaveAttribute(
      "href",
      `/wallet/voucher/${VOUCHER}`,
    );
  });

  it("shows a redemption with no known voucher as plain text, not a link to nowhere", async () => {
    await show([burn("burn_2")]);

    expect(screen.getByText(/Redeemed 120 points/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Redeemed 120 points/ })).not.toBeInTheDocument();
  });
});
