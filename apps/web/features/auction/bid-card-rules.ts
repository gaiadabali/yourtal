import type { BillingCard } from "@yourtal/contracts/billing";

/**
 * True when a bid in this region charges a saved card and none is saved yet.
 * Not in `bid-card.tsx`: the auction page is a server component, and a
 * function exported from a "use client" module cannot be called on the server.
 */
export function needsCardToBid(card: BillingCard | null): boolean {
  return card !== null && card.required && card.card === null;
}
