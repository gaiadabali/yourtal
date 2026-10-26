import { AUCTION_DURATION_HOURS } from "@yourtal/contracts/auction/auction";
import type { VoucherGiftBlock } from "@yourtal/contracts/voucher-internal/wallet";

/** apps/api refuses to list a voucher that would expire within the auction plus a day to use it. */
export const LISTING_MIN_LIFE_DAYS = AUCTION_DURATION_HOURS / 24 + 1;

export type PassNotice = VoucherGiftBlock | "teen" | "unavailable" | "expires_soon";

export interface PassOptions {
  canGift: boolean;
  canList: boolean;
  /** Why the voucher cannot be gifted or listed, or only not listed; null when both work. */
  notice: PassNotice | null;
}

export interface PassInput {
  /** The voucher can be shown at a counter now; an archived one has its own explanation. */
  redeemable: boolean;
  ageBand: "teen" | "adult" | undefined;
  giftable: boolean | undefined;
  giftBlock: VoucherGiftBlock | undefined;
  expiresAt: string | undefined;
  nowMs: number;
}

/**
 * What the voucher page offers: Gift, List for charity, or the reason for
 * neither. The server's `giftable` is the rule; this only words it. The
 * service names the rule it applied in `giftBlock`; an older service that
 * does not gets the general line.
 */
export function passOptions(input: PassInput): PassOptions {
  const none = (notice: PassNotice | null): PassOptions => ({
    canGift: false,
    canList: false,
    notice,
  });
  if (!input.redeemable) return none(null);
  // F86: teens can neither give nor receive; an unknown age offers nothing.
  if (input.ageBand === "teen") return none("teen");
  if (input.ageBand !== "adult") return none("unavailable");
  if (input.giftable !== true) return none(input.giftBlock ?? "unavailable");
  const soon =
    input.expiresAt !== undefined &&
    Date.parse(input.expiresAt) - input.nowMs < LISTING_MIN_LIFE_DAYS * 86_400_000;
  return { canGift: true, canList: !soon, notice: soon ? "expires_soon" : null };
}
