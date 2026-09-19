import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  expiredVoucherFixture,
  expiringWithinHourVoucherFixture,
} from "@yourtal/contracts/voucher/mock";
import { WalletVoucherCard } from "./wallet-voucher-card";

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

describe("WalletVoucherCard", () => {
  it("links to the voucher's detail page via its title", () => {
    render(<WalletVoucherCard voucher={expiringWithinHourVoucherFixture} nowMs={nowMs} />);

    const link = screen.getByRole("link", { name: expiringWithinHourVoucherFixture.title });
    expect(link).toHaveAttribute("href", `/wallet/voucher/${expiringWithinHourVoucherFixture.id}`);
  });

  it("shows an already-expired voucher as archived and still fully viewable, never hidden", () => {
    render(<WalletVoucherCard voucher={expiredVoucherFixture} nowMs={nowMs} />);

    expect(screen.getByText("Kedaluwarsa")).toBeInTheDocument();
    expect(screen.getByText(expiredVoucherFixture.merchantName)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: expiredVoucherFixture.title })).toBeInTheDocument();
  });

  it("labels an active, unexpired voucher as active", () => {
    render(<WalletVoucherCard voucher={expiringWithinHourVoucherFixture} nowMs={nowMs} />);

    expect(screen.getByText("Aktif")).toBeInTheDocument();
  });
});

describe("WalletVoucherCard (en-AU, YT-0405)", () => {
  it("labels status in English and renders the remaining value in AUD, never a hardcoded Rp", () => {
    render(
      <WalletVoucherCard
        voucher={expiringWithinHourVoucherFixture}
        nowMs={nowMs}
        locale="en-AU"
        currency="AUD"
      />,
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/^\$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Rp/)).not.toBeInTheDocument();
  });

  it("shows an archived voucher's end date in English", () => {
    render(
      <WalletVoucherCard
        voucher={expiredVoucherFixture}
        nowMs={nowMs}
        locale="en-AU"
        currency="AUD"
      />,
    );

    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/^Ended /)).toBeInTheDocument();
  });
});
