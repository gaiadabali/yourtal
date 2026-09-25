import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { mixedStateBalanceFixture, zeroBalanceFixture } from "@yourtal/contracts/balance/mock";
import { expiredVoucherFixture } from "@yourtal/contracts/voucher/mock";
import { WalletScreen } from "./wallet-screen";

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

describe("WalletScreen (id-ID)", () => {
  it("shows the taught empty state for a genuinely new user — zero balance, zero vouchers", () => {
    render(
      <WalletScreen
        balance={zeroBalanceFixture}
        vouchers={[]}
        history={[]}
        nowMs={nowMs}
        locale="id-ID"
      />,
    );

    expect(screen.getByText("Belum ada poin di sini")).toBeInTheDocument();
    expect(screen.queryByText(/Saldo tersedia/)).not.toBeInTheDocument();
  });

  it("shows the real balance card once there is anything to show, even with a zero balance", () => {
    render(
      <WalletScreen
        balance={zeroBalanceFixture}
        vouchers={[expiredVoucherFixture]}
        history={[]}
        nowMs={nowMs}
        locale="id-ID"
      />,
    );

    expect(screen.getByText("Saldo tersedia")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada poin di sini")).not.toBeInTheDocument();
  });

  it("shows the real balance card for a normal, non-empty wallet", () => {
    render(
      <WalletScreen
        balance={mixedStateBalanceFixture}
        vouchers={[]}
        history={[]}
        nowMs={nowMs}
        locale="id-ID"
      />,
    );

    expect(screen.getByText("Saldo tersedia")).toBeInTheDocument();
    expect(screen.getByText("Wallet")).toBeInTheDocument();
    expect(screen.getByText("Riwayat poin")).toBeInTheDocument();
  });
});

describe("WalletScreen (en-AU, YT-0405)", () => {
  it("shows every heading in English, with no Indonesian copy leaking through", () => {
    const { container } = render(
      <WalletScreen
        balance={mixedStateBalanceFixture}
        vouchers={[]}
        history={[]}
        nowMs={nowMs}
        locale="en-AU"
      />,
    );

    expect(screen.getByText("Available balance")).toBeInTheDocument();
    expect(screen.getByText("Points history")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Saldo tersedia|Riwayat poin/);
  });
});
