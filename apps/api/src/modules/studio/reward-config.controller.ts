import { Body, Controller, Inject, Param, Put } from "@nestjs/common";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { SetRewardConfigDto } from "./dto/set-reward-config.schema";
import { CAMPAIGN_DRAFT_REPOSITORY } from "./persistence/campaign-draft.repository";
import type { CampaignDraftRepository } from "./persistence/campaign-draft.repository";
import { REWARD_CONFIG_REPOSITORY } from "./persistence/reward-config.repository";
import type { RewardConfigRepository } from "./persistence/reward-config.repository";
import { setRewardConfig } from "./use-cases/set-reward-config.use-case";
import { mapStudioErrorToHttpException } from "./to-http-exception";

/** TASKS.md 7.3.c. */
@Controller("api/:tenantId/studio/campaigns/:campaignId/reward")
export class RewardConfigController {
  constructor(
    @Inject(CAMPAIGN_DRAFT_REPOSITORY) private readonly drafts: CampaignDraftRepository,
    @Inject(REWARD_CONFIG_REPOSITORY) private readonly rewardConfigs: RewardConfigRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
  ) {}

  // A full replacement (PUT), not a delta — a business setting the same
  // reward twice ends at the same row.
  @NotValueMoving("A full PUT of the same reward config ends at the same row.")
  @Authorize({ kind: "campaign", action: "edit", idFrom: (request) => campaignIdOf(request) })
  @Put()
  async set(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
    @Body() body: SetRewardConfigDto,
  ) {
    const result = await setRewardConfig(
      { drafts: this.drafts, rewardConfigs: this.rewardConfigs, ledger: this.ledger },
      {
        businessId: tenantId,
        campaignId,
        allocationId: body.allocationId,
        rewardPointsPerCompletion: body.rewardPointsPerCompletion,
        accuracyBonusPoints: body.accuracyBonusPoints,
        maxPointsForCampaign: body.maxPointsForCampaign,
      },
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }
}

function campaignIdOf(request: { params: unknown }): string {
  const params = request.params;
  if (typeof params !== "object" || params === null) return "";
  const value: unknown = Reflect.get(params, "campaignId");
  return typeof value === "string" ? value : "";
}
