import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletVoucherList } from "./wallet-voucher-list";
import { walletTestTranslator } from "./wallet-test-translator";

let locale: "en-AU" | "id-ID" = "id-ID";
vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator(locale),
}));

const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

// Deliberately not containing "aktif"/"Arsip"/"Tukar poin": these are
// display-data fixtures, and a substring collision with the section
// copy below would make an assertion pass or fail for the wrong reason.
const heldVoucher: WalletVoucherDetail = {
  voucherId: "00000000-0000-4000-8000-000000000001",
  listingId: "00000000-0000-4000-8000-000000000010",
  state: "activated",
  status: "active",
  merchantName: "Kopi Kenangan",
  title: "Kopi Kenangan voucher",
  currency: "IDR",
  remainingValueMinor: 50_000,
  expiresAt: "2026-10-19T09:00:00.000Z",
};
const releasedVoucher: WalletVoucherDetail = {
  ...heldVoucher,
  voucherId: "00000000-0000-4000-8000-000000000002",
  merchantName: "Toko Berkah",
  title: "Toko Berkah voucher",
  state: "released",
  status: undefined,
};

describe("WalletVoucherList (id-ID)", () => {
  it("splits active and archived vouchers into their own sections, both visible", async () => {
    locale = "id-ID";
    render(
      await WalletVoucherList({ vouchers: [heldVoucher, releasedVoucher], nowMs, locale: "id-ID" }),
    );

    expect(screen.getByRole("heading", { name: "Voucher aktif" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Arsip/ })).toBeInTheDocument();
    expect(screen.getByText(heldVoucher.merchantName!)).toBeInTheDocument();
    expect(screen.getByText(releasedVoucher.merchantName!)).toBeInTheDocument();
  });

  it("omits the archive section entirely when nothing is archived", async () => {
    locale = "id-ID";
    render(await WalletVoucherList({ vouchers: [heldVoucher], nowMs, locale: "id-ID" }));

    expect(screen.queryByRole("heading", { name: /Arsip/ })).not.toBeInTheDocument();
  });

  it("teaches how to get a voucher when there are no active ones, instead of an empty grid", async () => {
    locale = "id-ID";
    render(await WalletVoucherList({ vouchers: [releasedVoucher], nowMs, locale: "id-ID" }));

    expect(screen.getByText(/Tukar poin di Toko/)).toBeInTheDocument();
  });
});

describe("WalletVoucherList (en-AU)", () => {
  it("shows section headings and empty-active copy in English, with no Indonesian copy leaking through", async () => {
    locale = "en-AU";
    const { container } = render(
      await WalletVoucherList({ vouchers: [releasedVoucher], nowMs, locale: "en-AU" }),
    );

    expect(screen.getByRole("heading", { name: "Active vouchers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Archive/ })).toBeInTheDocument();
    expect(screen.getByText(/Redeem points in the Store/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Voucher aktif|Arsip|Tukar poin/);
  });
});
