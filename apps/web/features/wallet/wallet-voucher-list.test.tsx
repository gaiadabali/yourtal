import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { expiredVoucherFixture, expiringWithinHourVoucherFixture } from "@yourtal/contracts/voucher/mock";
import { WalletVoucherList } from "./wallet-voucher-list";

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

describe("WalletVoucherList", () => {
  it("splits active and archived vouchers into their own sections, both visible", () => {
    render(<WalletVoucherList vouchers={[expiringWithinHourVoucherFixture, expiredVoucherFixture]} nowMs={nowMs} />);

    expect(screen.getByRole("heading", { name: "Voucher aktif" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Arsip/ })).toBeInTheDocument();
    expect(screen.getByText(expiringWithinHourVoucherFixture.merchantName)).toBeInTheDocument();
    expect(screen.getByText(expiredVoucherFixture.merchantName)).toBeInTheDocument();
  });

  it("omits the archive section entirely when nothing is archived", () => {
    render(<WalletVoucherList vouchers={[expiringWithinHourVoucherFixture]} nowMs={nowMs} />);

    expect(screen.queryByRole("heading", { name: /Arsip/ })).not.toBeInTheDocument();
  });

  it("teaches how to get a voucher when there are no active ones, instead of an empty grid", () => {
    render(<WalletVoucherList vouchers={[expiredVoucherFixture]} nowMs={nowMs} />);

    expect(screen.getByText(/Tukar poin di Store/)).toBeInTheDocument();
  });
});
