import "server-only";

import { auctionListSchema, auctionSchema, type Auction } from "@yourtal/contracts/auction/auction";
import type { PublicCharity } from "@yourtal/contracts/charity/charity";
import { listCharitiesOrNull } from "@/features/charity/charity-data";
import { apiFetch } from "@/lib/api/api-fetch";

export interface AuctionFilter {
  readonly charityId: string | null;
  readonly category: string | null;
}

/** A refusal code from `AUCTION_REFUSALS`, or `failed` for anything else. */
export type AuctionWrite = { ok: true; auction: Auction } | { ok: false; code: string };

/** 13.22.d: every read and write the auction pages make, against the 13.22 API. */
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

export const auctionSource: AuctionSource = {
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
  charities() {
    return listCharitiesOrNull();
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
