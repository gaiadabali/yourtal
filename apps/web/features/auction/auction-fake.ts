import "server-only";

import {
  AUCTION_DURATION_HOURS,
  AUCTION_EXTENSION_SECONDS,
  auctionReserve,
  minimumNextBid,
  type Auction,
} from "@yourtal/contracts/auction/auction";
import type { PublicCharity } from "@yourtal/contracts/charity/charity";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import { getRegion } from "@/features/region/get-region";
import { getWalletVoucher } from "@/features/wallet/wallet-data";
import type { AuctionSource } from "./auction-source";

/**
 * Local dev only (13.22.d, until A2's API lands): an in-memory auction house
 * per region, from one viewer's point of view, following the contract's rules.
 * Nothing here moves money or touches a voucher.
 */
const HOUR = 3_600_000;
const CHARITIES: Record<Region, PublicCharity[]> = {
  AU: [
    {
      id: "0f000000-0000-4000-8000-00000000a001",
      region: "AU",
      name: "Lantern Street Reading Circle",
      cause: "children_youth",
      summary: "Books and reading tutors for primary schools in Western Sydney.",
      logoUrl: null,
    },
    {
      id: "0f000000-0000-4000-8000-00000000a002",
      region: "AU",
      name: "Saltbush Dune Keepers",
      cause: "environment",
      summary: "Volunteers replanting dunes along the NSW coast.",
      logoUrl: null,
    },
    {
      id: "0f000000-0000-4000-8000-00000000a003",
      region: "AU",
      name: "Plate Forward Pantry",
      cause: "food_security",
      summary: "Rescues surplus food from cafés for community pantries.",
      logoUrl: null,
    },
  ],
  ID: [
    {
      id: "0f000000-0000-4000-8000-00000000b001",
      region: "ID",
      name: "Yayasan Rak Buku Keliling Lentera",
      cause: "education",
      summary: "Perpustakaan keliling untuk sekolah dasar di Jawa Barat.",
      logoUrl: null,
    },
    {
      id: "0f000000-0000-4000-8000-00000000b002",
      region: "ID",
      name: "Yayasan Akar Bakau Lestari",
      cause: "environment",
      summary: "Menanam dan merawat mangrove di pesisir utara Jakarta.",
      logoUrl: null,
    },
    {
      id: "0f000000-0000-4000-8000-00000000b003",
      region: "ID",
      name: "Yayasan Kaki Empat Bahagia",
      cause: "animals",
      summary: "Klinik gratis untuk hewan terlantar di Bandung.",
      logoUrl: null,
    },
  ],
};

type Seed = {
  title: string;
  merchant: string;
  category: string;
  face: number;
  hoursLeft: number;
  bids: number[];
  mine?: "leading" | "outbid" | "seller" | "won";
};
const SEEDS: Record<Region, Seed[]> = {
  AU: [
    {
      title: "Breakfast for two",
      merchant: "Southern Cross Coffee",
      category: "food_beverage",
      face: 4000,
      hoursLeft: 50,
      bids: [2000, 2200],
      mine: "leading",
    },
    {
      title: "Board wax and fin set",
      merchant: "Bondi Board Co.",
      category: "retail",
      face: 6000,
      hoursLeft: 20,
      bids: [3000, 3200, 3400],
      mine: "outbid",
    },
    {
      title: "Half-day city tour",
      merchant: "Sydney Skyline Tours",
      category: "services",
      face: 12000,
      hoursLeft: 0.02,
      bids: [6000, 6600],
    },
    {
      title: "Sourdough class",
      merchant: "Adelaide Artisan Bakery",
      category: "food_beverage",
      face: 8000,
      hoursLeft: 70,
      bids: [],
      mine: "seller",
    },
    {
      title: "Wool beanie",
      merchant: "Tasmania Wool Co.",
      category: "retail",
      face: 5000,
      hoursLeft: -5,
      bids: [2500, 2700],
      mine: "won",
    },
  ],
  ID: [
    {
      title: "Paket kopi susu",
      merchant: "Kopi Nusantara",
      category: "food_beverage",
      face: 100000,
      hoursLeft: 40,
      bids: [50000, 55000],
      mine: "leading",
    },
    {
      title: "Kain batik tulis",
      merchant: "Bali Batik House",
      category: "retail",
      face: 400000,
      hoursLeft: 12,
      bids: [200000, 210000, 225000],
      mine: "outbid",
    },
    {
      title: "Servis motor lengkap",
      merchant: "Jakarta Jaya Motor",
      category: "services",
      face: 250000,
      hoursLeft: 66,
      bids: [],
      mine: "seller",
    },
    {
      title: "Boba untuk empat",
      merchant: "Bandung Boba Bar",
      category: "food_beverage",
      face: 80000,
      hoursLeft: -3,
      bids: [40000, 42000],
      mine: "won",
    },
  ],
};

interface Entry {
  auction: Omit<Auction, "viewer">;
  mine: Auction["currentAmountMinor"];
  seller: boolean;
}
const houses = new Map<Region, Entry[]>();
const m = toMinorUnits;

function charityRef(c: PublicCharity) {
  return { id: c.id, name: c.name, cause: c.cause, logoUrl: c.logoUrl };
}

function build(region: Region): Entry[] {
  const currency = region === "AU" ? "AUD" : "IDR";
  const now = Date.now();
  return SEEDS[region].map((seed, index) => {
    const endsAt = now + seed.hoursLeft * HOUR;
    const last = seed.bids.at(-1);
    const current = last === undefined ? null : m(last);
    const ended = seed.hoursLeft < 0;
    const reserve = m(auctionReserve(seed.face));
    const charity = CHARITIES[region][index % CHARITIES[region].length] ?? CHARITIES[region][0];
    if (!charity) throw new Error("no fake charity");
    return {
      seller: seed.mine === "seller",
      mine:
        seed.mine === "leading" || seed.mine === "won"
          ? current
          : seed.mine === "outbid"
            ? m(seed.bids.at(-2) ?? 0)
            : null,
      auction: {
        auctionId: `0a000000-0000-4000-8000-${region === "AU" ? "a" : "b"}${String(index).padStart(11, "0")}`,
        region,
        currency,
        charity: charityRef(charity),
        voucher: {
          title: seed.title,
          merchantName: seed.merchant,
          category: seed.category,
          faceValueMinor: m(seed.face),
          expiresAt: new Date(now + 300 * 24 * HOUR).toISOString(),
        },
        reserveMinor: reserve,
        currentAmountMinor: current,
        minimumNextBidMinor: m(minimumNextBid(currency, reserve, current)),
        bidCount: seed.bids.length,
        startsAt: new Date(endsAt - AUCTION_DURATION_HOURS * HOUR).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        state: ended ? "ended" : "open",
        outcome: ended ? (current === null ? "unsold" : "sold") : null,
      },
    };
  });
}

function house(region: Region): Entry[] {
  let entries = houses.get(region);
  if (!entries) houses.set(region, (entries = build(region)));
  // Close anything whose time has run out, as the server's settle job would.
  for (const e of entries) {
    if (e.auction.state === "open" && Date.parse(e.auction.endsAt) <= Date.now()) {
      e.auction.state = "ended";
      e.auction.outcome = e.auction.currentAmountMinor === null ? "unsold" : "sold";
    }
  }
  return entries;
}

function view(e: Entry): Auction {
  const a = e.auction;
  const leading = e.mine !== null && e.mine === a.currentAmountMinor;
  const bidStatus =
    e.mine === null
      ? "none"
      : a.state === "open"
        ? leading
          ? "leading"
          : "outbid"
        : leading
          ? "won"
          : "lost";
  return {
    ...a,
    viewer: {
      role: e.seller ? "seller" : e.mine === null ? "none" : "bidder",
      bidStatus,
      yourHighestBidMinor: e.mine,
    },
  };
}

export const fakeAuctionSource: AuctionSource = {
  async list(filter) {
    const entries = house(await getRegion());
    return entries
      .filter((e) => e.auction.state === "open")
      .filter((e) => !filter.charityId || e.auction.charity.id === filter.charityId)
      .filter((e) => !filter.category || e.auction.voucher.category === filter.category)
      .map(view);
  },
  async get(auctionId) {
    const e = house(await getRegion()).find((x) => x.auction.auctionId === auctionId);
    return e ? view(e) : null;
  },
  async myBids() {
    return house(await getRegion())
      .filter((e) => e.mine !== null)
      .map(view);
  },
  async myListings() {
    return house(await getRegion())
      .filter((e) => e.seller)
      .map(view);
  },
  async charities() {
    return CHARITIES[await getRegion()];
  },
  async bid(auctionId, amountMinor) {
    const e = house(await getRegion()).find((x) => x.auction.auctionId === auctionId);
    if (!e) return { ok: false, code: "failed" };
    const a = e.auction;
    if (e.seller) return { ok: false, code: "own_auction" };
    if (a.state !== "open") return { ok: false, code: "auction_closed" };
    if (!Number.isInteger(amountMinor) || amountMinor < a.minimumNextBidMinor)
      return { ok: false, code: "bid_too_low" };
    a.currentAmountMinor = m(amountMinor);
    a.bidCount += 1;
    a.minimumNextBidMinor = m(minimumNextBid(a.currency, a.reserveMinor, amountMinor));
    const extendTo = Date.now() + AUCTION_EXTENSION_SECONDS * 1000;
    if (Date.parse(a.endsAt) < extendTo) a.endsAt = new Date(extendTo).toISOString();
    e.mine = m(amountMinor);
    return { ok: true, auction: view(e) };
  },
  async listVoucher(voucherId, charityId) {
    const region = await getRegion();
    const charity = CHARITIES[region].find((c) => c.id === charityId);
    if (!charity) return { ok: false, code: "charity_unavailable" };
    const voucher = await getWalletVoucher(voucherId);
    if (!voucher.ok) return { ok: false, code: "voucher_not_unused" };
    const face = voucher.data.faceValueMinor ?? 0;
    const currency = region === "AU" ? "AUD" : "IDR";
    const now = Date.now();
    const entry: Entry = {
      seller: true,
      mine: null,
      auction: {
        auctionId: crypto.randomUUID(),
        region,
        currency,
        charity: charityRef(charity),
        voucher: {
          title: voucher.data.title ?? "Voucher",
          merchantName: voucher.data.merchantName ?? "",
          category: "retail",
          faceValueMinor: m(face),
          expiresAt: voucher.data.expiresAt ?? new Date(now + 90 * 24 * HOUR).toISOString(),
        },
        reserveMinor: m(auctionReserve(face)),
        currentAmountMinor: null,
        minimumNextBidMinor: m(auctionReserve(face)),
        bidCount: 0,
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(now + AUCTION_DURATION_HOURS * HOUR).toISOString(),
        state: "open",
        outcome: null,
      },
    };
    house(region).push(entry);
    return { ok: true, auction: view(entry) };
  },
};
