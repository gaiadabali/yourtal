import { type Auction, minimumNextBid } from "@yourtal/contracts/auction/auction";
import type { CharityCause } from "@yourtal/contracts/charity";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { AuctionRow } from "../persistence/auction-store";

/**
 * The public shape: amount, count and times, and the caller's own
 * standing. The leader's and bidders' identities never leave the server.
 */
export function presentAuction(
  row: AuctionRow,
  viewerId: string | null,
  viewerHighestBidMinor: number | null,
  now: Date = new Date(),
): Auction {
  const open = row.state === "open" && row.endsAt.getTime() > now.getTime();
  const isSeller = viewerId !== null && viewerId === row.sellerId;
  const hasBid = viewerHighestBidMinor !== null;
  const bidStatus: Auction["viewer"]["bidStatus"] = !hasBid
    ? "none"
    : row.state === "open"
      ? row.leaderBidderId === viewerId
        ? "leading"
        : "outbid"
      : row.winnerId === viewerId
        ? "won"
        : "lost";

  return {
    auctionId: row.id,
    region: row.region,
    currency: row.currency,
    charity: {
      id: row.charityId,
      name: row.charityName,
      cause: row.charityCause as CharityCause,
      logoUrl: row.charityLogoUrl,
    },
    voucher: {
      title: row.title,
      merchantName: row.merchantName,
      category: row.category,
      faceValueMinor: toMinorUnits(row.faceValueMinor),
      expiresAt: row.voucherExpiresAt.toISOString(),
    },
    reserveMinor: toMinorUnits(row.reserveMinor),
    currentAmountMinor:
      row.currentAmountMinor === null ? null : toMinorUnits(row.currentAmountMinor),
    minimumNextBidMinor: toMinorUnits(
      minimumNextBid(row.currency, row.reserveMinor, row.currentAmountMinor),
    ),
    bidCount: row.bidCount,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    state: row.state === "cancelled" ? "cancelled" : open ? "open" : "ended",
    outcome: row.outcome,
    viewer: {
      role: isSeller ? "seller" : hasBid ? "bidder" : "none",
      bidStatus,
      yourHighestBidMinor:
        viewerHighestBidMinor === null ? null : toMinorUnits(viewerHighestBidMinor),
    },
  };
}
