import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Auction } from "@yourtal/contracts/auction/auction";
import enAU from "@/messages/en-AU/auction.json";
import { AuctionCard } from "./auction-card";

/** The real catalogue behind a stand-in translator, as the wallet tests do; plurals are not asserted here. */
vi.mock("next-intl/server", () => ({
  getTranslations: () => (key: string, values?: Record<string, string | number>) => {
    const raw = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], enAU);
    if (typeof raw !== "string") throw new Error(`missing auction key ${key}`);
    return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(values?.[name] ?? ""));
  },
}));

const ended = {
  auctionId: "49807c3c-33af-4026-bf51-f2aab5b82143",
  region: "AU",
  currency: "AUD",
  charity: {
    id: "73c13c37-0fc2-4e83-aeb3-2f00a045a994",
    name: "Coastal Kids Trust",
    cause: "children_youth",
    logoUrl: null,
  },
  voucher: {
    title: "A free coffee",
    merchantName: "Harbour Grind Café",
    category: "food-and-drink",
    faceValueMinor: 600,
    expiresAt: "2027-10-01T05:36:25.775Z",
  },
  reserveMinor: 300,
  currentAmountMinor: 400,
  minimumNextBidMinor: 500,
  bidCount: 2,
  startsAt: "2026-10-02T01:40:22.988Z",
  endsAt: "2026-10-05T01:40:22.987Z",
  state: "ended",
  outcome: "sold",
  viewer: { role: "bidder", bidStatus: "lost", yourHighestBidMinor: 300 },
} as unknown as Auction;

const NOW = Date.parse("2026-10-21T00:00:00.000Z");

describe("AuctionCard", () => {
  it("says an ended auction was lost once, and how it ended, instead of 'Ended' twice", async () => {
    render(await AuctionCard({ auction: ended, locale: "en-AU", nowMs: NOW }));

    expect(screen.queryAllByText("Ended")).toHaveLength(0);
    expect(screen.getByText("Not won")).toBeInTheDocument();
    expect(screen.getByText("Sold")).toBeInTheDocument();
  });

  it("falls back to 'Ended' for an auction that closed with no outcome yet, once", async () => {
    const settling = { ...ended, outcome: null } as Auction;
    render(await AuctionCard({ auction: settling, locale: "en-AU", nowMs: NOW }));

    expect(screen.getAllByText("Ended")).toHaveLength(1);
  });

  it("shows the time left for an open auction", async () => {
    const open = {
      ...ended,
      state: "open",
      outcome: null,
      endsAt: new Date(NOW + 5 * 3_600_000).toISOString(),
      viewer: { role: "bidder", bidStatus: "leading", yourHighestBidMinor: 400 },
    } as Auction;
    render(await AuctionCard({ auction: open, locale: "en-AU", nowMs: NOW }));

    expect(screen.getByText("5 h 0 min left")).toBeInTheDocument();
    expect(screen.getByText("You're leading")).toBeInTheDocument();
  });
});
