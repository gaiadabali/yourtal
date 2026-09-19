import type { Campaign } from "@yourtal/contracts/campaign";
import { generateCampaign, longMerchantNameCampaignFixture, mockCampaigns, zeroRewardCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import type { Question } from "@yourtal/contracts/question";
import { generateQuestions } from "@yourtal/contracts/question/mock";

export interface CheckpointData {
  campaign: Campaign;
  questions: Question[];
}

const ALL_MOCK_CAMPAIGNS: Campaign[] = [...mockCampaigns, zeroRewardCampaignFixture, longMerchantNameCampaignFixture];

/**
 * A small, deterministic, non-cryptographic string hash (djb2 variant).
 * Deliberately byte-for-byte the same algorithm as
 * `apps/web/features/player/get-watch-campaign.ts`'s `hashStringToSeed` —
 * that module (YT-0412, the player this route hands off from) never
 * dead-ends on an unrecognised `campaignId`: it synthesizes a deterministic
 * campaign from the id itself. This route has to resolve the *same*
 * campaignId to the *exact same* campaign (same reward figures, same
 * scoring rule) or the checkpoint result screen would honour different
 * terms than the player just showed — which is exactly the honesty rule
 * this ticket's brief points at (YT-0411: "the terms shown are the terms
 * honoured"). Kept as a small local duplicate rather than a shared import
 * since feature folders don't share code across owners in this ticket's
 * scope; worth promoting to a `packages/contracts` helper later, since two
 * independent features already needed the identical function.
 */
function hashStringToSeed(value: string): number {
  let hash = 5_381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}

/**
 * A second, differently-mixed hash (FNV-1a) used only to seed *which*
 * questions a campaign shows — deliberately distinct from
 * `hashStringToSeed` above (which seeds the campaign's own synthesis) so
 * the two draws don't correlate.
 */
function hashCampaignIdForQuestions(campaignId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < campaignId.length; index += 1) {
    hash ^= campaignId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function resolveCampaign(campaignId: string): Campaign {
  const known = ALL_MOCK_CAMPAIGNS.find((campaign) => campaign.id === campaignId);
  return known ?? generateCampaign({ seed: hashStringToSeed(campaignId) });
}

/**
 * Always resolves a campaign in mock mode — never 404s on an unrecognised
 * id, matching the player's "never dead-end" contract above. A campaign
 * with `questionCount === 0` is a legitimate, honoured shape (docs/06): the
 * route still renders, with an empty question bank, so `CheckpointQuiz`
 * goes straight to the (base-reward-only) result screen instead of
 * gating on questions that don't exist.
 */
function loadMockCheckpointData(campaignId: string): CheckpointData {
  const campaign = resolveCampaign(campaignId);
  const questions =
    campaign.questionCount === 0 ? [] : generateQuestions(campaign.questionCount, hashCampaignIdForQuestions(campaignId), campaignId);
  return { campaign, questions };
}

function loadLiveCheckpointData(_campaignId: string): CheckpointData {
  throw new Error(
    "Live checkpoint data source is not implemented yet. YOURTAL_DATA_SOURCE=live is not usable for " +
      "/watch/[campaignId]/checkpoint until the BFF endpoint exists — this intentionally throws rather " +
      "than silently serving mock data under a 'live' label.",
  );
}

/**
 * The single seam between mock and live data for this route, per
 * `@yourtal/contracts/mock-source`'s documented pattern: resolved once, at
 * module scope, from the shared `YOURTAL_DATA_SOURCE` switch.
 */
export const getCheckpointData: (campaignId: string) => CheckpointData = resolveDataSource({
  mock: loadMockCheckpointData,
  live: loadLiveCheckpointData,
});
