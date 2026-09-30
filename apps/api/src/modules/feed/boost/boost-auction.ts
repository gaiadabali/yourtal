/**
 * 13.23.b: the Home feed's boost slots, as a pure function. Only campaigns
 * already in the viewer's walled, filtered feed may bid, so boost can never
 * widen a region, audience or interest wall; it only moves a card into a slot.
 *
 * Each slot is a sealed second-price auction among the eligible boosts not
 * yet placed: the highest `maxBidCpmMinor` wins and pays the next-highest
 * bid plus one minor unit (never above its own bid), or the reserve when it
 * bids alone. A boost whose remaining daily budget cannot cover the price is
 * out for the day.
 */

/** Zero-based feed positions held for boost, in order. */
export const BOOST_SLOT_POSITIONS: readonly number[] = [0, 6];

export interface BoostBid {
  readonly campaignId: string;
  readonly maxBidCpmMinor: number;
  readonly dailyBudgetMinor: number;
  /** Already spent today, in thousandths of a minor unit. */
  readonly spentMilliToday: number;
}

export interface BoostAward {
  readonly slot: number;
  readonly campaignId: string;
  /** The clearing price per 1,000 impressions; one impression costs this many thousandths. */
  readonly priceCpmMinor: number;
}

function canAfford(bid: BoostBid, priceCpmMinor: number): boolean {
  return bid.spentMilliToday + priceCpmMinor <= bid.dailyBudgetMinor * 1000;
}

/** Awards slots in order. `bids` must hold only campaigns present in the organic feed. */
export function runBoostAuction(
  bids: readonly BoostBid[],
  reserveCpmMinor: number,
  slotCount: number = BOOST_SLOT_POSITIONS.length,
): BoostAward[] {
  // Highest bid first; ties go to the lower id so the outcome is stable.
  let open = bids
    .filter((bid) => bid.maxBidCpmMinor >= reserveCpmMinor)
    .sort(
      (a, b) => b.maxBidCpmMinor - a.maxBidCpmMinor || a.campaignId.localeCompare(b.campaignId),
    );
  const awards: BoostAward[] = [];

  for (let slot = 0; slot < slotCount && open.length > 0; slot += 1) {
    let placed = false;
    while (!placed && open.length > 0) {
      const [winner, runnerUp] = open;
      if (winner === undefined) break;
      const second = runnerUp?.maxBidCpmMinor;
      const price = Math.min(
        winner.maxBidCpmMinor,
        Math.max(reserveCpmMinor, second === undefined ? reserveCpmMinor : second + 1),
      );
      open = open.slice(1);
      if (canAfford(winner, price)) {
        awards.push({ slot, campaignId: winner.campaignId, priceCpmMinor: price });
        placed = true;
      }
    }
  }
  return awards;
}

/** Moves each awarded card to its slot position, marked boosted; everything else keeps its order. */
export function placeBoosted<T extends { readonly campaignId: string }>(
  items: readonly T[],
  awards: readonly BoostAward[],
): (T & { boosted: boolean })[] {
  const awarded = new Set(awards.map((award) => award.campaignId));
  const organic = items
    .filter((item) => !awarded.has(item.campaignId))
    .map((item) => ({ ...item, boosted: false }));
  const byId = new Map(items.map((item) => [item.campaignId, item]));
  const result = [...organic];
  for (const award of awards) {
    const item = byId.get(award.campaignId);
    if (item === undefined) continue;
    const position = Math.min(BOOST_SLOT_POSITIONS[award.slot] ?? result.length, result.length);
    result.splice(position, 0, { ...item, boosted: true });
  }
  return result;
}
