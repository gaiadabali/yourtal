import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletVoucherCard } from "./wallet-voucher-card";
import { walletTestTranslator } from "./wallet-test-translator";

let locale: "en-AU" | "id-ID" = "id-ID";
vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator(locale),
}));

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

const heldVoucher: WalletVoucherDetail = {
  voucherId: "00000000-0000-4000-8000-000000000001",
  listingId: "00000000-0000-4000-8000-000000000010",
  state: "activated",
  merchantName: "Toko Berkah",
  title: "Toko Berkah IDR 50.000 voucher",
  currency: "IDR",
  remainingValueMinor: 50_000,
  expiresAt: "2026-10-19T09:00:00.000Z",
};

const releasedVoucher: WalletVoucherDetail = {
  ...heldVoucher,
  voucherId: "00000000-0000-4000-8000-000000000002",
  state: "released",
  expiresAt: "2026-09-01T09:00:00.000Z",
};

describe("WalletVoucherCard", () => {
  it("links to the voucher's detail page via its title", async () => {
    locale = "id-ID";
    render(await WalletVoucherCard({ voucher: heldVoucher, nowMs, locale: "id-ID" }));

    const link = screen.getByRole("link", { name: heldVoucher.title! });
    expect(link).toHaveAttribute("href", `/wallet/voucher/${heldVoucher.voucherId}`);
  });

  it("shows an already-expired voucher as archived and still fully viewable, never hidden", async () => {
    locale = "id-ID";
    render(await WalletVoucherCard({ voucher: releasedVoucher, nowMs, locale: "id-ID" }));

    expect(screen.getByText("Kedaluwarsa")).toBeInTheDocument();
    expect(screen.getByText(releasedVoucher.merchantName!)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: releasedVoucher.title! })).toBeInTheDocument();
  });

  it("labels a held, unexpired voucher as active", async () => {
    locale = "id-ID";
    render(await WalletVoucherCard({ voucher: heldVoucher, nowMs, locale: "id-ID" }));

    expect(screen.getByText("Aktif")).toBeInTheDocument();
  });

  it("shows a generic placeholder title and 'details unavailable' when the live API has not sent display fields yet", async () => {
    locale = "id-ID";
    const bare: WalletVoucherDetail = {
      voucherId: "00000000-0000-4000-8000-000000000003",
      listingId: "00000000-0000-4000-8000-000000000010",
      state: "activated",
    };
    render(await WalletVoucherCard({ voucher: bare, nowMs, locale: "id-ID" }));

    expect(screen.getByText("Voucher")).toBeInTheDocument();
    expect(screen.getByText("Detail tidak tersedia")).toBeInTheDocument();
  });
});

describe("WalletVoucherCard (en-AU)", () => {
  it("labels status in English and renders the remaining value in AUD, never a hardcoded Rp", async () => {
    locale = "en-AU";
    const auVoucher: WalletVoucherDetail = { ...heldVoucher, currency: "AUD" };
    render(await WalletVoucherCard({ voucher: auVoucher, nowMs, locale: "en-AU" }));

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/^\$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Rp/)).not.toBeInTheDocument();
  });

  it("shows an archived voucher's end date in English", async () => {
    locale = "en-AU";
    render(await WalletVoucherCard({ voucher: releasedVoucher, nowMs, locale: "en-AU" }));

    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/^Ended /)).toBeInTheDocument();
  });
});
