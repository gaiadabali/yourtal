import {
  FORBIDDEN,
  PDP_UNAVAILABLE,
  VALIDATION_400,
  nestDefaultError,
  ref,
  type RouteDefinition,
  type RoutePathParam,
} from "./route-registry-shared";

/** 13.22 (F86): charity auctions, in their own file like the other splits. */
const AUCTION_ID: RoutePathParam = {
  name: "auctionId",
  description: "The auction's id.",
  schema: { type: "string", format: "uuid" },
};
const VOUCHER_ID: RoutePathParam = {
  name: "voucherId",
  description: "The caller's own voucher.",
  schema: { type: "string", format: "uuid" },
};
const NOT_FOUND = nestDefaultError(404, "No such auction, or no such voucher held by the caller.");
const REFUSED = nestDefaultError(409, "Refused with one AuctionRefusal code.");
const ERRORS = [FORBIDDEN, PDP_UNAVAILABLE];

export const AUCTION_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/wallet/vouchers/{voucherId}/auction",
    summary: "List an unused voucher in a 3-day auction for a charity",
    tags: ["auction"],
    pathParams: [VOUCHER_ID],
    requestBody: { description: "The charity.", schema: ref("ListVoucherForAuctionBody") },
    successStatus: 201,
    successDescription: "The open auction. The voucher's old code no longer works.",
    successSchema: ref("Auction"),
    errors: [VALIDATION_400, ...ERRORS, NOT_FOUND, REFUSED],
  },
  {
    method: "get",
    path: "/api/auctions",
    summary: "Open auctions in the caller's region, optionally by charity or category",
    tags: ["auction"],
    pathParams: [],
    queryParams: [
      {
        name: "charityId",
        description: "Only this charity's.",
        required: false,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "category",
        description: "Only this voucher category.",
        required: false,
        schema: { type: "string" },
      },
    ],
    successStatus: 200,
    successDescription: "Soonest to close first.",
    successSchema: ref("AuctionList"),
    errors: ERRORS,
  },
  {
    method: "get",
    path: "/api/auctions/mine/bids",
    summary: "Auctions the caller has bid in",
    tags: ["auction"],
    pathParams: [],
    successStatus: 200,
    successDescription: "Each with the caller's own standing.",
    successSchema: ref("AuctionList"),
    errors: ERRORS,
  },
  {
    method: "get",
    path: "/api/auctions/mine/listings",
    summary: "Auctions the caller listed",
    tags: ["auction"],
    pathParams: [],
    successStatus: 200,
    successDescription: "Open and closed.",
    successSchema: ref("AuctionList"),
    errors: ERRORS,
  },
  {
    method: "get",
    path: "/api/auctions/{auctionId}",
    summary: "One auction: amount, bid count and times, never who bid",
    tags: ["auction"],
    pathParams: [AUCTION_ID],
    successStatus: 200,
    successDescription: "Settled first if it has passed its close.",
    successSchema: ref("Auction"),
    errors: [...ERRORS, NOT_FOUND],
  },
  {
    method: "post",
    path: "/api/auctions/{auctionId}/bids",
    summary: "Bid in cash; a payment hold is placed at once",
    tags: ["auction"],
    pathParams: [AUCTION_ID],
    requestBody: { description: "The amount, in minor units.", schema: ref("PlaceBidBody") },
    successStatus: 201,
    successDescription: "The auction after the bid.",
    successSchema: ref("Auction"),
    errors: [VALIDATION_400, ...ERRORS, NOT_FOUND, REFUSED],
  },
];
