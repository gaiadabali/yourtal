import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import { asDisplayPoints } from "@yourtal/contracts/money/money-format";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletScreen } from "./wallet-screen";
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

describe("WalletScreen (id-ID)", () => {
  it("shows the taught empty state for a genuinely new user — zero balance, zero vouchers", async () => {
    locale = "id-ID";
    render(
      await WalletScreen({
        balance: zeroBalance,
        vouchers: [],
        history: [],
        nowMs,
        locale: "id-ID",
      }),
    );

    expect(screen.getByText("Belum ada poin di sini")).toBeInTheDocument();
    expect(screen.queryByText(/Saldo tersedia/)).not.toBeInTheDocument();
  });

  it("shows the real balance card once there is anything to show, even with a zero balance", async () => {
    locale = "id-ID";
    render(
      await WalletScreen({
        balance: zeroBalance,
        vouchers: [releasedVoucher],
        history: [],
        nowMs,
        locale: "id-ID",
      }),
    );

    expect(screen.getByText("Saldo tersedia")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada poin di sini")).not.toBeInTheDocument();
  });

  it("shows the real balance card for a normal, non-empty wallet", async () => {
    locale = "id-ID";
    render(
      await WalletScreen({
        balance: mixedBalance,
        vouchers: [],
        history: [],
        nowMs,
        locale: "id-ID",
      }),
    );

    expect(screen.getByText("Saldo tersedia")).toBeInTheDocument();
    expect(screen.getByText("Dompet")).toBeInTheDocument();
    expect(screen.getByText("Riwayat poin")).toBeInTheDocument();
  });
});

describe("WalletScreen (en-AU)", () => {
  it("shows every heading in English, with no Indonesian copy leaking through", async () => {
    locale = "en-AU";
    const { container } = render(
      await WalletScreen({
        balance: mixedBalance,
        vouchers: [],
        history: [],
        nowMs,
        locale: "en-AU",
      }),
    );

    expect(screen.getByText("Available balance")).toBeInTheDocument();
    expect(screen.getByText("Points history")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Saldo tersedia|Riwayat poin/);
  });
});
