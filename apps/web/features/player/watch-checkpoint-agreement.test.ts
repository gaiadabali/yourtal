import { describe, expect, it } from "vitest";

import { getCheckpointData } from "../checkpoint/checkpoint-data";
import { getWatchCampaign } from "./get-watch-campaign";

/**
 * Cross-route invariant, not a unit test of either module.
 *
 * Neither `/watch/[campaignId]` nor `/watch/[campaignId]/checkpoint` 404s on
 * an id outside the fixed mock catalogue — both synthesise a campaign from a
 * seed derived from the id. They MUST land on the same campaign: the
 * checkpoint's reward figures are the ones the player just promised the user,
 * and YT-0411's rule is "terms shown here are the terms honoured".
 *
 * This was previously guarded only by the two routes having copy-pasted the
 * same hash function. Both now import `@yourtal/contracts/mock-seed`, and
 * this test is what fails if that ever diverges again.
 */
describe("watch and checkpoint agree on a synthesised campaign", () => {
  const unknownIds = ["not-in-the-catalogue", "yt-campaign-42", "abc", "9f3b-7c11-dead-beef"];

  it.each(unknownIds)("resolves %s to the same campaign on both routes", (campaignId) => {
    const fromPlayer = getWatchCampaign(campaignId);
    const fromCheckpoint = getCheckpointData(campaignId);

    expect(fromCheckpoint.campaign).toStrictEqual(fromPlayer);
  });

  it("agrees on the reward figure specifically, which is what the user was promised", () => {
    for (const campaignId of unknownIds) {
      const fromPlayer = getWatchCampaign(campaignId);
      const fromCheckpoint = getCheckpointData(campaignId);

      expect(fromCheckpoint.campaign.rewardPoints).toBe(fromPlayer.rewardPoints);
      expect(fromCheckpoint.campaign.questionCount).toBe(fromPlayer.questionCount);
      expect(fromCheckpoint.campaign.scoringRule).toBe(fromPlayer.scoringRule);
    }
  });
});
