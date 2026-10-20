import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
);
const startCardSetup = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./auction-source", () => ({
  auctionSource: { startCardSetup, bid: vi.fn(), listVoucher: vi.fn() },
}));

import { startBidCardAction } from "./auction-actions";

const AUCTION = "0b5f1c9e-2f43-4d8e-9a55-7a1c2d3e4f50";
const form = (auctionId: string) => {
  const data = new FormData();
  data.set("auctionId", auctionId);
  return data;
};

beforeEach(() => {
  redirect.mockClear();
  startCardSetup.mockReset();
});

describe("startBidCardAction (5.1.d)", () => {
  it("sends the bidder to the processor's own page", async () => {
    startCardSetup.mockResolvedValue({ checkoutUrl: "https://pay.example/cs_1", card: null });
    await expect(startBidCardAction(form(AUCTION))).rejects.toThrow(
      "NEXT_REDIRECT https://pay.example/cs_1",
    );
    expect(startCardSetup).toHaveBeenCalledWith(AUCTION);
  });

  it("comes straight back to the auction when the card is saved at once", async () => {
    startCardSetup.mockResolvedValue({ checkoutUrl: null, card: {} });
    await expect(startBidCardAction(form(AUCTION))).rejects.toThrow(
      `NEXT_REDIRECT /auctions/${AUCTION}?card=saved`,
    );
  });

  it("says so when the card page could not be opened", async () => {
    startCardSetup.mockResolvedValue(null);
    await expect(startBidCardAction(form(AUCTION))).rejects.toThrow(
      `NEXT_REDIRECT /auctions/${AUCTION}?card=failed`,
    );
  });

  it("never builds a path from anything but an auction id", async () => {
    startCardSetup.mockResolvedValue(null);
    await expect(startBidCardAction(form("../../studio?x=1"))).rejects.toThrow(
      "NEXT_REDIRECT /auctions?card=failed",
    );
    expect(startCardSetup).toHaveBeenCalledWith(null);
  });
});
