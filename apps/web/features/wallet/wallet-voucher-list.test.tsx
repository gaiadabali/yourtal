import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  expiredVoucherFixture,
  expiringWithinHourVoucherFixture,
} from "@yourtal/contracts/voucher/mock";
import { WalletVoucherList } from "./wallet-voucher-list";

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

describe("WalletVoucherList (id-ID)", () => {
  it("splits active and archived vouchers into their own sections, both visible", () => {
    render(
      <WalletVoucherList
        vouchers={[expiringWithinHourVoucherFixture, expiredVoucherFixture]}
        nowMs={nowMs}
        locale="id-ID"
        currency="IDR"
      />,
    );

    expect(screen.getByRole("heading", { name: "Voucher aktif" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Arsip/ })).toBeInTheDocument();
    expect(screen.getByText(expiringWithinHourVoucherFixture.merchantName)).toBeInTheDocument();
    expect(screen.getByText(expiredVoucherFixture.merchantName)).toBeInTheDocument();
  });

  it("omits the archive section entirely when nothing is archived", () => {
    render(
      <WalletVoucherList
        vouchers={[expiringWithinHourVoucherFixture]}
        nowMs={nowMs}
        locale="id-ID"
        currency="IDR"
      />,
    );

    expect(screen.queryByRole("heading", { name: /Arsip/ })).not.toBeInTheDocument();
  });

  it("teaches how to get a voucher when there are no active ones, instead of an empty grid", () => {
    render(
      <WalletVoucherList
        vouchers={[expiredVoucherFixture]}
        nowMs={nowMs}
        locale="id-ID"
        currency="IDR"
      />,
    );

    expect(screen.getByText(/Tukar poin di Store/)).toBeInTheDocument();
  });
});

describe("WalletVoucherList (en-AU, YT-0405)", () => {
  it("shows section headings and empty-active copy in English, with no Indonesian copy leaking through", () => {
    const { container } = render(
      <WalletVoucherList
        vouchers={[expiredVoucherFixture]}
        nowMs={nowMs}
        locale="en-AU"
        currency="AUD"
      />,
    );

    expect(screen.getByRole("heading", { name: "Active vouchers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Archive/ })).toBeInTheDocument();
    expect(screen.getByText(/Redeem points in the Store/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Voucher aktif|Arsip|Tukar poin/);
  });
});
