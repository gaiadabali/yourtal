"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { auctionSource, type AuctionWrite } from "./auction-source";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * 5.1.d: save the card a bid holds, on the processor's own page. It comes back to the auction the
 * bidder was on with `?card=saved|cancelled`; a processor that saves at once comes straight back.
 */
export async function startBidCardAction(formData: FormData): Promise<void> {
  const id = formData.get("auctionId");
  const auctionId = typeof id === "string" && UUID.test(id) ? id : null;
  const back = (outcome: string) =>
    `${auctionId === null ? "/auctions" : `/auctions/${auctionId}`}?card=${outcome}` as Route;

  const started = await auctionSource.startCardSetup(auctionId);
  if (started === null) redirect(back("failed"));
  redirect((started.checkoutUrl ?? back("saved")) as Route);
}
