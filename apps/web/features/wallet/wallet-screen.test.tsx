import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import { asDisplayPoints } from "@yourtal/contracts/money/money-format";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletScreen, walletHref } from "./wallet-screen";
import { walletTestTranslator } from "./wallet-test-translator";

let locale: "en-AU" | "id-ID" = "id-ID";
vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator(locale),
}));

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

const zeroBalance: WalletSummary = {
  region: "ID",
  availablePoints: asDisplayPoints(0),
  pendingPoints: asDisplayPoints(0),
  pending: [],
  expiringPoints: asDisplayPoints(0),
  expiringAt: null,
};
const mixedBalance: WalletSummary = {
  region: "ID",
  availablePoints: asDisplayPoints(8_400),
  pendingPoints: asDisplayPoints(1_200),
  pending: [{ points: asDisplayPoints(1_200), unlockAt: "2026-09-22T09:00:00.000Z" }],
  expiringPoints: asDisplayPoints(0),
  expiringAt: null,
};
const releasedVoucher: WalletVoucherDetail = {
  voucherId: "00000000-0000-4000-8000-000000000001",
  listingId: "00000000-0000-4000-8000-000000000010",
  state: "released",
};
const baseProps = {
  history: [],
  historyNextCursor: null,
  nextReward: null,
  affordable: [],
  view: { tab: "active" as const, history: "all" as const, historyAfter: null },
  region: "ID" as const,
  nowMs,
};

describe("WalletScreen (id-ID)", () => {
  it("explains the loop in three steps for a new wallet, with one button to Home (13.19.e)", async () => {
    locale = "id-ID";
    render(
      await WalletScreen({ ...baseProps, balance: zeroBalance, vouchers: [], locale: "id-ID" }),
    );
    expect(screen.getByText("Dompet Anda sudah siap")).toBeInTheDocument();
    expect(screen.getByText("Tonton")).toBeInTheDocument();
    expect(screen.getByText("Tukarkan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cari video di Beranda" })).toHaveAttribute(
      "href",
      "/home",
    );
    expect(screen.queryByText("Bisa dipakai")).not.toBeInTheDocument();
  });

  it("shows the balance card once there is anything to show", async () => {
    locale = "id-ID";
    render(
      await WalletScreen({
        ...baseProps,
        balance: zeroBalance,
        vouchers: [releasedVoucher],
        locale: "id-ID",
      }),
    );
    expect(screen.getByText("Bisa dipakai")).toBeInTheDocument();
    expect(screen.queryByText("Dompet Anda sudah siap")).not.toBeInTheDocument();
  });

  it("shows pending points with when they land (13.19.a)", async () => {
    locale = "id-ID";
    render(
      await WalletScreen({ ...baseProps, balance: mixedBalance, vouchers: [], locale: "id-ID" }),
    );
    expect(screen.getByText("Dompet")).toBeInTheDocument();
    expect(screen.getByText("Riwayat poin")).toBeInTheDocument();
    expect(screen.getByText(/sedang diproses, tersedia/)).toBeInTheDocument();
  });
});

describe("WalletScreen (en-AU)", () => {
  it("shows every heading in English, with no Indonesian copy leaking through", async () => {
    locale = "en-AU";
    const { container } = render(
      await WalletScreen({
        ...baseProps,
        region: "AU",
        balance: mixedBalance,
        vouchers: [],
        locale: "en-AU",
      }),
    );
    expect(screen.getByText("Available to spend")).toBeInTheDocument();
    expect(screen.getByText("Points history")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Bisa dipakai|Riwayat poin/);
  });
});

describe("walletHref", () => {
  it("keeps the tab and history filter in the URL, defaults left out", () => {
    expect(walletHref({ tab: "active", history: "all", historyAfter: null })).toBe("/wallet");
    expect(walletHref({ tab: "past", history: "earned", historyAfter: null })).toBe(
      "/wallet?vouchers=past&history=earned",
    );
  });
});
