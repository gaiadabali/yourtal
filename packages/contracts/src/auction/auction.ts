import { z } from "zod";
import { charityCauseSchema } from "../charity/charity";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/**
 * 13.22 (F86): charity auctions. A viewer lists an unused voucher for a
 * verified charity in their region; verified adults in the region bid in
 * cash; the winner's payment goes straight to the charity's own account,
 * never through YourTal (red line 8). Nobody's identity is ever shown: an
 * auction shows its current amount and bid count, and the caller's own
 * standing only.
 *
 * `POST /api/wallet/vouchers/{voucherId}/auction` → `Auction` (201)
 * `GET /api/auctions?charityId=&category=` → `AuctionList` (open, own region)
 * `GET /api/auctions/{auctionId}` → `Auction`
 * `POST /api/auctions/{auctionId}/bids` → `Auction` (201)
 * `GET /api/auctions/mine/bids` and `/api/auctions/mine/listings` → `AuctionList`
 */
export const AUCTION_DURATION_HOURS = 72;
/** A bid in the last 2 minutes pushes the close out to 2 minutes from that bid. */
export const AUCTION_EXTENSION_SECONDS = 120;

export const listVoucherForAuctionBodySchema = z.object({ charityId: z.uuid() });
export type ListVoucherForAuctionBody = z.infer<typeof listVoucherForAuctionBodySchema>;

export const placeBidBodySchema = z.object({ amountMinor: minorUnitsSchema });
export type PlaceBidBody = z.infer<typeof placeBidBodySchema>;

/** `ended` covers sold and unsold; `outcome` says which once it is settled. */
export const auctionStateSchema = z.enum(["open", "ended", "cancelled"]);
export type AuctionState = z.infer<typeof auctionStateSchema>;

export const auctionOutcomeSchema = z.enum(["sold", "unsold", "cancelled"]);
export type AuctionOutcome = z.infer<typeof auctionOutcomeSchema>;

/** The caller's own standing. Never anyone else's. */
export const auctionViewerSchema = z.object({
  role: z.enum(["seller", "bidder", "none"]),
  bidStatus: z.enum(["leading", "outbid", "won", "lost", "none"]),
  yourHighestBidMinor: minorUnitsSchema.nullable(),
});
export type AuctionViewer = z.infer<typeof auctionViewerSchema>;

export const auctionSchema = z.object({
  auctionId: z.uuid(),
  region: regionSchema,
  currency: currencySchema,
  charity: z.object({
    id: z.uuid(),
    name: z.string(),
    cause: charityCauseSchema,
    logoUrl: z.url().nullable(),
  }),
  voucher: z.object({
    title: z.string(),
    merchantName: z.string(),
    category: z.string(),
    faceValueMinor: minorUnitsSchema,
    expiresAt: z.iso.datetime(),
  }),
  /** 50% of face value: the first bid must reach it. */
  reserveMinor: minorUnitsSchema,
  currentAmountMinor: minorUnitsSchema.nullable(),
  /** The smallest bid the server will take now (reserve, or current plus the increment). */
  minimumNextBidMinor: minorUnitsSchema,
  bidCount: z.number().int().min(0),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  state: auctionStateSchema,
  outcome: auctionOutcomeSchema.nullable(),
  viewer: auctionViewerSchema,
});
export type Auction = z.infer<typeof auctionSchema>;

export const auctionListSchema = z.object({ auctions: z.array(auctionSchema) });
export type AuctionList = z.infer<typeof auctionListSchema>;

/**
 * A refused listing or bid answers 409 `{ code, message }` with one of
 * these. `bidder_ineligible` covers an unverified, suspended, teen or
 * other-region caller alike.
 */
export const AUCTION_REFUSALS = [
  "charity_unavailable",
  "voucher_not_unused",
  "voucher_not_transferable",
  "voucher_already_transferred",
  "seller_ineligible",
  "bidder_ineligible",
  "own_auction",
  "auction_closed",
  "bid_too_low",
  "payment_declined",
] as const;
export const auctionRefusalSchema = z.enum(AUCTION_REFUSALS);
export type AuctionRefusal = z.infer<typeof auctionRefusalSchema>;

/**
 * The next acceptable bid. The increment is 5% of the current amount,
 * rounded up, and never less than one major unit (AUD 1.00, IDR 1,000).
 * The server computes it; clients only display it.
 */
export function minimumNextBid(
  currency: "AUD" | "IDR",
  reserveMinor: number,
  currentAmountMinor: number | null,
): number {
  if (currentAmountMinor === null) return reserveMinor;
  const floor = currency === "AUD" ? 100 : 1000;
  return currentAmountMinor + Math.max(floor, Math.ceil(currentAmountMinor * 0.05));
}

/** 50% of face value, rounded up to a whole minor unit. */
export function auctionReserve(faceValueMinor: number): number {
  return Math.ceil(faceValueMinor / 2);
}
