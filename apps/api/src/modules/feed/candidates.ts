import type { Campaign } from "@yourtal/contracts/campaign";
import type { Region } from "@yourtal/contracts/region";
import type { CampaignRepository } from "../campaign/persistence/campaign.repository";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import type { CandidateCampaign } from "./ranking";

const CANDIDATE_FETCH_LIMIT = 300;

/**
 * Shared by `get-feed.use-case.ts` and `search.use-case.ts`: every live,
 * in-region campaign that still has a funded, unpaused allocation behind it
 * -- "funded" meaning the allocation itself (holds already netted out by the
 * ledger's own `remainingPoints`), not just that a `reward_config` row
 * exists. A campaign with no config, or whose allocation id no longer
 * resolves, is simply absent from the result -- see the try/catch note
 * inline, which mirrors `fake-ledger-funding.ts`'s own "not found is a
 * caller bug, not a client-input case" contract.
 */
export async function fetchFundedCampaigns(
  campaigns: CampaignRepository,
  ledger: Pick<LedgerInternalClient, "getAllocation">,
  region: Region,
): Promise<CandidateCampaign[]> {
  const visible = await campaigns.listVisible(CANDIDATE_FETCH_LIMIT);
  const regionCandidates = visible.filter((campaign) => campaign.region === region);

  const rewardConfigs = await Promise.all(
    regionCandidates.map((campaign) => campaigns.rewardConfigFor(campaign.id)),
  );

  const withConfig = regionCandidates
    .map((campaign, index) => ({ campaign, rewardConfig: rewardConfigs[index] ?? null }))
    .filter(
      (
        entry,
      ): entry is {
        campaign: Campaign;
        rewardConfig: NonNullable<(typeof rewardConfigs)[number]>;
      } => entry.rewardConfig !== null,
    );

  const allocations = await Promise.allSettled(
    withConfig.map((entry) => ledger.getAllocation(entry.rewardConfig.allocationId)),
  );

  return withConfig
    .map((entry, index) => {
      const settled = allocations[index];
      if (settled === undefined || settled.status === "rejected" || settled.value.isErr())
        return null;
      const allocation = settled.value.value;
      return {
        campaign: entry.campaign,
        rewardConfig: entry.rewardConfig,
        allocationRemainingPoints: Number(allocation.remainingPoints),
        allocationTotalPoints: Number(allocation.totalPoints),
      };
    })
    .filter((candidate): candidate is CandidateCampaign => candidate !== null);
}
