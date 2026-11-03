import type { WalletGift } from "@yourtal/contracts/wallet/wallet-gift";

/** What happened to a voucher that now reads "Transferred", when the gifts say. */
type PassedOnStatus = { status: "pending" | "accepted" };

export interface PassedOn {
  /** A pending gift can still come back; an accepted one cannot. */
  status: "pending" | "accepted";
  sentAt: string;
  acceptBy: string;
}

/**
 * A sent gift names its original voucher, so a transferred voucher can say it
 * was given away and when. One that was listed for a charity, or whose gift
 * came back as a new voucher, has no such line and gets the general words.
 */
export function passedOnBy(voucherId: string, gifts: readonly WalletGift[]): PassedOn | null {
  const gift = gifts.find(
    (g): g is WalletGift & PassedOnStatus =>
      g.direction === "sent" && g.voucherId === voucherId && g.status !== "returned",
  );
  if (gift === undefined) return null;
  return { status: gift.status, sentAt: gift.createdAt, acceptBy: gift.acceptBy };
}
