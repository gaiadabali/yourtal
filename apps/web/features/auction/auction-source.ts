import "server-only";

import { auctionListSchema, auctionSchema, type Auction } from "@yourtal/contracts/auction/auction";
import { publicCharityListSchema, type PublicCharity } from "@yourtal/contracts/charity/charity";
import { apiFetch } from "@/lib/api/api-fetch";
import { resolveStudioDataSource } from "@/features/studio/studio-data-source";
import { fakeAuctionSource } from "./auction-fake";

export interface AuctionFilter {
  readonly charityId: string | null;
  readonly category: string | null;
}

/** A refusal code from `AUCTION_REFUSALS`, or `failed` for anything else. */
export type AuctionWrite = { ok: true; auction: Auction } | { ok: false; code: string };

/**
 * 13.22.d: every read and write the auction pages make, against the 13.22
 * contract. Live on staging and production; a stateful fake in local dev
 * until the API lands (the same switch as Studio's).
 */
export interface AuctionSource {
  list(filter: AuctionFilter): Promise<Auction[] | null>;
  get(auctionId: string): Promise<Auction | null>;
  myBids(): Promise<Auction[] | null>;
  myListings(): Promise<Auction[] | null>;
  charities(): Promise<PublicCharity[] | null>;
  bid(auctionId: string, amountMinor: number): Promise<AuctionWrite>;
  listVoucher(voucherId: string, charityId: string): Promise<AuctionWrite>;
}

function refusal(error: { kind: string; code?: string }): { ok: false; code: string } {
  return { ok: false, code: error.kind === "http" && error.code ? error.code : "failed" };
}

const liveAuctionSource: AuctionSource = {
  async list(filter) {
    const params = new URLSearchParams();
    if (filter.charityId) params.set("charityId", filter.charityId);
    if (filter.category) params.set("category", filter.category);
    const qs = params.toString();
    const result = await apiFetch(`/api/auctions${qs ? `?${qs}` : ""}`, auctionListSchema);
    return result.ok ? result.data.auctions : null;
  },
  async get(auctionId) {
    const result = await apiFetch(`/api/auctions/${encodeURIComponent(auctionId)}`, auctionSchema);
    return result.ok ? result.data : null;
  },
  async myBids() {
    const result = await apiFetch("/api/auctions/mine/bids", auctionListSchema);
    return result.ok ? result.data.auctions : null;
  },
  async myListings() {
    const result = await apiFetch("/api/auctions/mine/listings", auctionListSchema);
    return result.ok ? result.data.auctions : null;
  },
  async charities() {
    const result = await apiFetch("/api/charities", publicCharityListSchema);
    return result.ok ? result.data.charities : null;
  },
  async bid(auctionId, amountMinor) {
    const result = await apiFetch(
      `/api/auctions/${encodeURIComponent(auctionId)}/bids`,
      auctionSchema,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { amountMinor },
      },
    );
    return result.ok ? { ok: true, auction: result.data } : refusal(result.error);
  },
  async listVoucher(voucherId, charityId) {
    const result = await apiFetch(
      `/api/wallet/vouchers/${encodeURIComponent(voucherId)}/auction`,
      auctionSchema,
      { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: { charityId } },
    );
    return result.ok ? { ok: true, auction: result.data } : refusal(result.error);
  },
};

export const auctionSource: AuctionSource = resolveStudioDataSource({
  mock: fakeAuctionSource,
  live: liveAuctionSource,
});
