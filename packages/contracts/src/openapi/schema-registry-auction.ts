import {
  auctionListSchema,
  auctionRefusalSchema,
  auctionSchema,
  listVoucherForAuctionBodySchema,
  placeBidBodySchema,
  startBidderCardBodySchema,
} from "../auction/auction";
import type { ContractComponent } from "./schema-registry";

/** 13.22's charity auction components, split out for the 300-line ceiling. */
export const AUCTION_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "ListVoucherForAuctionBody",
    schema: listVoucherForAuctionBodySchema,
    description: "Which approved charity in the caller's region the auction is for.",
    crossFieldRules: [],
  },
  {
    id: "PlaceBidBody",
    schema: placeBidBodySchema,
    description: "A cash bid in the auction's currency, integer minor units.",
    crossFieldRules: [],
  },
  {
    id: "StartBidderCardBody",
    schema: startBidderCardBodySchema,
    description:
      "Optionally the auction the bidder came from, so the card page returns there. Never a URL.",
    crossFieldRules: [],
  },
  {
    id: "Auction",
    schema: auctionSchema,
    description:
      "A charity auction: amount, bid count and times, never who bid. `viewer` is the caller's own standing only.",
    crossFieldRules: [],
  },
  {
    id: "AuctionList",
    schema: auctionListSchema,
    description: "Open auctions in the caller's region, or the caller's own bids or listings.",
    crossFieldRules: [],
  },
  {
    id: "AuctionRefusal",
    schema: auctionRefusalSchema,
    description: "Why a listing or a bid was refused (409).",
    crossFieldRules: [],
  },
];
