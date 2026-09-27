import type { FeedSignalsRepository } from "../persistence/feed-signals.repository";

/** 7.7.a: "not interested" -- a signed-in-only signal, recorded once, checked by `ranking.ts`'s `demotedCampaignIds`. */
export async function markNotInterested(
  signals: FeedSignalsRepository,
  userId: string,
  campaignId: string,
): Promise<void> {
  await signals.demote(userId, campaignId);
}
