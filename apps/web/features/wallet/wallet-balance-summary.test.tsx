import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import { asDisplayPoints } from "@yourtal/contracts/money/money-format";
import { WalletBalanceSummary } from "./wallet-balance-summary";
import { walletTestTranslator } from "./wallet-test-translator";

let locale: "en-AU" | "id-ID" = "id-ID";
vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator(locale),
}));

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

// The live `GET /api/wallet` shape (4.8.a): pending is one row PER GRANT,
// each with its own unlockAt — never a single collapsed date.
const mixedBalance: WalletSummary = {
  region: "ID",
  availablePoints: asDisplayPoints(8_400),
  pendingPoints: asDisplayPoints(1_700),
  pending: [
    { points: asDisplayPoints(1_200), unlockAt: "2026-09-22T09:00:00.000Z" },
    { points: asDisplayPoints(500), unlockAt: "2026-09-24T09:00:00.000Z" },
  ],
  expiringPoints: asDisplayPoints(300),
  expiringAt: "2026-09-26T09:00:00.000Z",
};

const zeroBalance: WalletSummary = {
  region: "ID",
  availablePoints: asDisplayPoints(0),
  pendingPoints: asDisplayPoints(0),
  pending: [],
  expiringPoints: asDisplayPoints(0),
  expiringAt: null,
};

describe("WalletBalanceSummary", () => {
  it("shows available balance and one row per pending grant, each with its own unlock date", async () => {
    locale = "id-ID";
    render(await WalletBalanceSummary({ balance: mixedBalance, nowMs, locale: "id-ID" }));

    expect(screen.getByText(/8\.400/)).toBeInTheDocument();
    expect(screen.getByText(/1\.200/)).toBeInTheDocument();
    expect(screen.getByText(/300/)).toBeInTheDocument();
    // Two pending grants and one expiring row must each show *when*.
    expect(screen.getAllByText(/cair|hari/).length).toBeGreaterThanOrEqual(2);
  });

  it("shows no pending or expiring section when there is nothing there", async () => {
    locale = "id-ID";
    render(await WalletBalanceSummary({ balance: zeroBalance, nowMs, locale: "id-ID" }));

    expect(screen.getByLabelText("0 tersedia")).toBeInTheDocument();
    expect(screen.queryByText("Menunggu pencairan")).not.toBeInTheDocument();
  });
});

describe("WalletBalanceSummary (en-AU)", () => {
  it("shows available and pending balances in English with their unlock dates", async () => {
    locale = "en-AU";
    render(await WalletBalanceSummary({ balance: mixedBalance, nowMs, locale: "en-AU" }));

    expect(screen.getByText(/8,400/)).toBeInTheDocument();
    expect(screen.getAllByText(/unlocks|days?/).length).toBeGreaterThanOrEqual(2);
  });
});
