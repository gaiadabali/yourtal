import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Auction } from "@yourtal/contracts/auction/auction";
import { toMinorUnits } from "@yourtal/contracts/money";
import enAuction from "@/messages/en-AU/auction.json";
import idAuction from "@/messages/id-ID/auction.json";
import AuctionPage from "./page";

const mocks = vi.hoisted(() => ({ get: vi.fn(), locale: { current: "en-AU" } }));

vi.mock("@/features/auction/auction-source", () => ({
  auctionSource: { get: mocks.get, card: () => Promise.resolve(null) },
}));
vi.mock("@/features/auction/auction-page-shell", () => ({
  AuctionPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/features/auction/bid-card", () => ({ BidCard: () => null }));
vi.mock("@/features/auction/auction-bid-form", () => ({
  AuctionBidForm: ({ minimumLabel }: { minimumLabel: string }) => (
    <p data-testid="minimum">{minimumLabel}</p>
  ),
}));
vi.mock("@/i18n/get-locale", () => ({
  getDisplayLocale: () => Promise.resolve(mocks.locale.current),
}));
vi.mock("next/navigation", () => ({ notFound: () => undefined }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: (namespace: "auction") =>
      Promise.resolve(
        createTranslator({
          locale: mocks.locale.current,
          messages: { auction: mocks.locale.current === "en-AU" ? enAuction : idAuction },
          namespace,
        } as never),
      ),
  };
});

const auction = (over: Partial<Auction["viewer"]> = {}): Auction => ({
  auctionId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  region: "AU",
  currency: "AUD",
  charity: {
    id: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b11",
    name: "Harbour Kids",
    cause: "education",
    logoUrl: null,
  },
  voucher: {
    title: "Coffee voucher",
    merchantName: "Harbour Grind",
    category: "food",
    faceValueMinor: toMinorUnits(5_000),
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
  reserveMinor: toMinorUnits(2_500),
  currentAmountMinor: toMinorUnits(3_000),
  minimumNextBidMinor: toMinorUnits(3_150),
  bidCount: 2,
  startsAt: "2026-10-18T00:00:00.000Z",
  endsAt: "2099-10-21T00:00:00.000Z",
  state: "open",
  outcome: null,
  viewer: {
    role: "bidder",
    bidStatus: "leading",
    yourHighestBidMinor: toMinorUnits(3_000),
    ...over,
  },
});

async function show(locale: "en-AU" | "id-ID") {
  mocks.locale.current = locale;
  mocks.get.mockResolvedValue(auction());
  render(
    await AuctionPage({
      params: Promise.resolve({ auctionId: "a" }),
      searchParams: Promise.resolve({}),
    }),
  );
}

afterEach(() => vi.resetAllMocks());

describe("the auction page", () => {
  it("names its bid panel, so it is told apart from the shell's side navigation", async () => {
    await show("en-AU");
    expect(screen.getByRole("complementary", { name: "Bidding" })).toBeInTheDocument();
  });

  it("names the bid panel in Indonesian", async () => {
    await show("id-ID");
    expect(screen.getByRole("complementary", { name: "Penawaran" })).toBeInTheDocument();
  });

  it("writes the viewer's own bid and the minimum bid in the viewer's language, in the auction's currency", async () => {
    await show("id-ID");
    expect(screen.getByText("Kamu penawar tertinggi di AU$30,00.")).toBeInTheDocument();
    expect(screen.getByTestId("minimum")).toHaveTextContent("AU$31,50");
  });
});
