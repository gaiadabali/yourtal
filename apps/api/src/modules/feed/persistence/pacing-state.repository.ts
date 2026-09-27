/**
 * 7.7.b: advisory per-campaign pacing (`feed.pacing_state`). The hard stop
 * on delivery is the ledger's allocation hold; this only smooths how a
 * still-funded campaign's remaining budget is spread across a day.
 */
export interface PacingStateRepository {
  /** Whether this campaign may still be served today, advisory only. */
  canServe(campaignId: string): Promise<boolean>;
  /** Records one serve. Rolls `served_today` over to 0 on a new day. */
  recordServe(campaignId: string): Promise<void>;
}

export const PACING_STATE_REPOSITORY = Symbol("PACING_STATE_REPOSITORY");
