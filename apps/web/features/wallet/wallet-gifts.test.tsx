import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WalletGift } from "@yourtal/contracts/wallet/wallet-gift";
import { WalletGiftInbox, WalletGiftsSection } from "./wallet-gifts";
import { walletTestTranslator } from "./wallet-test-translator";

vi.mock("next-intl/server", () => ({ getTranslations: () => walletTestTranslator("en-AU") }));
vi.mock("./gift-response-buttons", () => ({
  GiftResponseButtons: ({ title }: { title: string }) => (
    <button type="button">Accept {title}</button>
  ),
}));

function gift(overrides: Partial<WalletGift>): WalletGift {
  return {
    giftId: "00000000-0000-4000-8000-000000000001",
    direction: "received",
    status: "pending",
    senderDisplayName: "Sam Taylor",
    voucherId: "00000000-0000-4000-8000-000000000002",
    title: "Coffee voucher",
    merchantName: "Snap App",
    currency: "AUD",
    faceValueMinor: 449,
    voucherExpiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-09-30T00:00:00.000Z",
    acceptBy: "2026-10-07T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  } as WalletGift;
}

describe("gifts in the wallet (13.20.c)", () => {
  it("asks for an answer on a pending received gift, naming only the sender's display name", async () => {
    render(<>{await WalletGiftInbox({ gifts: [gift({})], locale: "en-AU" })}</>);
    expect(screen.getByText("Sam Taylor sent you Coffee voucher")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Coffee voucher" })).toBeInTheDocument();
  });

  it("lists sent gifts without naming the recipient, and never links an accepted one", async () => {
    render(
      <>
        {await WalletGiftsSection({
          gifts: [
            gift({
              direction: "sent",
              status: "accepted",
              senderDisplayName: null,
              resolvedAt: "2026-10-01T00:00:00.000Z",
            }),
          ],
          locale: "en-AU",
        })}
      </>,
    );
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sam Taylor/)).not.toBeInTheDocument();
  });

  it("shows nothing when there are no gifts", async () => {
    expect(await WalletGiftInbox({ gifts: [], locale: "en-AU" })).toBeNull();
    expect(await WalletGiftsSection({ gifts: [], locale: "en-AU" })).toBeNull();
  });
});
