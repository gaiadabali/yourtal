import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletGift } from "@yourtal/contracts/wallet/wallet-gift";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletVouchers } from "./wallet-vouchers";
import { walletTestTranslator } from "./wallet-test-translator";

vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator("en-AU"),
}));

const NOW = Date.parse("2026-10-21T00:00:00.000Z");
const coffee = (voucherId: string): WalletVoucherDetail => ({
  voucherId,
  listingId: "c3adea66-5c25-5fa6-ba1f-b370efee7c17",
  state: "activated",
  status: "active",
  merchantName: "Harbour Grind Café",
  title: "A free coffee",
  currency: "AUD",
  faceValueMinor: 600,
  remainingValueMinor: 600,
  expiresAt: "2027-10-01T05:36:25.775Z",
});

const GIFTED = "623310cf-a8db-46e4-ab5b-fb1bcf43cbd8";
const BOUGHT = "adb7132e-4f51-4aff-8283-82d4539e2ae5";

describe("WalletVouchers: two cards with one title", () => {
  it("renders each voucher once, as its own link, and says which one came as a gift", async () => {
    const gift = {
      giftId: "d7461e1e-4e2f-4213-bc44-1ddcd5d95784",
      direction: "received",
      status: "accepted",
      senderDisplayName: "Alex Viewer",
      voucherId: GIFTED,
    } as WalletGift;
    render(
      await WalletVouchers({
        vouchers: [coffee(GIFTED), coffee(BOUGHT)],
        tab: "active",
        tabHref: () => "/wallet",
        nowMs: NOW,
        locale: "en-AU",
        gifts: [gift],
      }),
    );

    const links = screen.getAllByRole("link", { name: "A free coffee" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/wallet/voucher/${GIFTED}`,
      `/wallet/voucher/${BOUGHT}`,
    ]);
    expect(screen.getAllByText("Gift from Alex Viewer")).toHaveLength(1);
  });

  it("shows no origin line when there are no gifts", async () => {
    render(
      await WalletVouchers({
        vouchers: [coffee(BOUGHT)],
        tab: "active",
        tabHref: () => "/wallet",
        nowMs: NOW,
        locale: "en-AU",
      }),
    );

    expect(screen.queryByText(/^Gift from/)).not.toBeInTheDocument();
  });
});
