"use server";

import { auctionSource, type AuctionWrite } from "./auction-source";

/** 13.22.b: the server checks the amount against its own minimum; the page only shows it. */
export async function placeBidAction(
  auctionId: string,
  amountMinor: number,
): Promise<AuctionWrite> {
  return auctionSource.bid(auctionId, amountMinor);
}

/** 13.22.a: the voucher's code stops working as soon as it is listed. */
export async function listVoucherAction(
  voucherId: string,
  charityId: string,
): Promise<AuctionWrite> {
  return auctionSource.listVoucher(voucherId, charityId);
}
