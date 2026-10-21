import type { Campaign } from "@yourtal/contracts/campaign";
import type { Region } from "@yourtal/contracts/region";
import type { CampaignRepository } from "../campaign/persistence/campaign.repository";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import type { SuspendedBusinessLookup } from "./persistence/suspended-business-lookup";
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
 *
 * TASKS.md 9.3.b: a suspended business's campaigns leave the feed too --
 * filtered out before the reward-config/allocation lookups below, so a
 * suspended business costs this function no extra ledger calls.
 */
export async function fetchFundedCampaigns(
  campaigns: CampaignRepository,
  ledger: Pick<LedgerInternalClient, "getAllocation" | "campaignBudgets">,
  suspendedBusinesses: SuspendedBusinessLookup,
  region: Region,
): Promise<CandidateCampaign[]> {
  const visible = await campaigns.listVisible(CANDIDATE_FETCH_LIMIT);
  const inRegion = visible.filter((campaign) => campaign.region === region);
  const suspendedIds = await suspendedBusinesses.suspendedIds(
    inRegion.map((campaign) => campaign.businessId),
  );
  const regionCandidates = inRegion.filter((campaign) => !suspendedIds.has(campaign.businessId));

  const rewardConfigs = await campaigns.rewardConfigsFor(
    regionCandidates.map((campaign) => campaign.id),
  );

  const withConfig = regionCandidates
    .map((campaign) => ({ campaign, rewardConfig: rewardConfigs.get(campaign.id) ?? null }))
    .filter(
      (
        entry,
      ): entry is {
        campaign: Campaign;
        rewardConfig: NonNullable<ReturnType<typeof rewardConfigs.get>>;
      } => entry.rewardConfig !== null,
    );

  const ids = withConfig.map((entry) => entry.campaign.id);
  const [allocations, districts, budgets] = await Promise.all([
    Promise.allSettled(
      withConfig.map((entry) => ledger.getAllocation(entry.rewardConfig.allocationId)),
    ),
    campaigns.targetDistrictsFor(ids),
    // 14.2: unread budgets leave the allocation as the feed's only funding
    // check; the session's hold still refuses a spent budget.
    ledger.campaignBudgets({ region, campaignIds: ids }).match(
      (rows) => new Map(rows.map((row) => [row.campaignId, row])),
      () => new Map<string, never>(),
    ),
  ]);

  return withConfig
    .map((entry, index) => {
      const settled = allocations[index];
      if (settled === undefined || settled.status === "rejected" || settled.value.isErr())
        return null;
      const allocation = settled.value.value;
      const budget = budgets.get(entry.campaign.id);
      return {
        campaign: entry.campaign,
        rewardConfig: entry.rewardConfig,
        allocationRemainingPoints: Number(allocation.remainingPoints),
        allocationTotalPoints: Number(allocation.totalPoints),
        targetDistricts: districts.get(entry.campaign.id) ?? [],
        budget:
          budget === undefined
            ? null
            : {
                remainingPoints: Number(budget.remainingPoints),
                remainingTodayPoints:
                  budget.remainingTodayPoints === null ? null : Number(budget.remainingTodayPoints),
              },
      };
    })
    .filter((candidate): candidate is CandidateCampaign => candidate !== null);
}
