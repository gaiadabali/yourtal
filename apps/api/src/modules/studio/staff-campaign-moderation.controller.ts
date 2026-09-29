import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { listCampaignModerationQueueResponseSchema } from "@yourtal/contracts/staff/moderation";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../shared/authz/authz-error.mapper";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { PDP_CLIENT } from "../../shared/pdp/pdp-client.module";
import { StaffAction, setStaffAuditContext } from "../staff/staff-action.decorator";
import { CAMPAIGN_DRAFT_REPOSITORY } from "./persistence/campaign-draft.repository";
import type { CampaignDraftRepository } from "./persistence/campaign-draft.repository";
import { QUESTION_BANK_REPOSITORY } from "./persistence/question-bank.repository";
import type { QuestionBankRepository } from "./persistence/question-bank.repository";
import { REWARD_CONFIG_REPOSITORY } from "./persistence/reward-config.repository";
import type { RewardConfigRepository } from "./persistence/reward-config.repository";
import { TERMS_VERSION_REPOSITORY } from "./persistence/terms-version.repository";
import type { TermsVersionRepository } from "./persistence/terms-version.repository";
import { CAMPAIGN_PUBLISHED_PUBLISHER } from "./campaign-published-publisher";
import type { CampaignPublishedPublisher } from "./campaign-published-publisher";
import {
  ApproveCampaignModerationDto,
  RejectCampaignModerationDto,
} from "./dto/staff-campaign-moderation.schema";
import { mapStudioErrorToHttpException } from "./to-http-exception";
import {
  approveCampaignModeration,
  listCampaignModerationQueue,
  rejectCampaignModeration,
} from "./use-cases/staff-campaign-moderation.use-cases";

/**
 * TASKS.md 9.2.a: the campaign-creative half of the staff moderation queue.
 * A `moderator` reviews an `in_review` campaign -- its creative, its
 * question bank's automated screen, and its declared audience/category --
 * and either takes it live (through `transitionCampaignLifecycle`, the SAME
 * function Studio's own submit path shares) or rejects it with a reason
 * Studio then shows the business.
 *
 * `list`/coarse-check both use the `view` action: `moderation_item.yaml`'s
 * `approve`/`reject` carry an unconditional "no reason, no decision" DENY
 * that a synchronous `@Authorize` (no request body to read yet) can never
 * satisfy, so a coarse check on THAT action would always refuse. `view` has
 * no such condition -- it only requires the `moderator` role -- so it is
 * the right coarse gate; the real approve/reject decision is the second,
 * explicit `pdp.requireAction` call below, once `reason` and the campaign's
 * real `businessId` are both known. Same two-call shape
 * `StaffVoucherBatchReviewController.approve` already uses.
 */
@Controller("api/staff/moderation/campaigns")
export class StaffCampaignModerationController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(CAMPAIGN_DRAFT_REPOSITORY) private readonly drafts: CampaignDraftRepository,
    @Inject(QUESTION_BANK_REPOSITORY) private readonly bank: QuestionBankRepository,
    @Inject(REWARD_CONFIG_REPOSITORY) private readonly rewardConfigs: RewardConfigRepository,
    @Inject(TERMS_VERSION_REPOSITORY) private readonly termsVersions: TermsVersionRepository,
    @Inject(CAMPAIGN_PUBLISHED_PUBLISHER) private readonly publisher: CampaignPublishedPublisher,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
  ) {}

  @StaffAction("campaign_moderation.list")
  @Authorize({ kind: "moderation_item", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list() {
    const result = await listCampaignModerationQueue({ drafts: this.drafts, bank: this.bank });
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    const payload = {
      items: result.value.map((item) => ({
        campaign: {
          id: item.campaign.id,
          businessId: item.campaign.businessId,
          region: item.campaign.region,
          title: item.campaign.title,
          synopsis: item.campaign.synopsis,
          audience: item.campaign.audience,
          contentCategory: item.campaign.contentCategory,
          lifecycleState: item.campaign.lifecycleState,
          rejectionReason: item.campaign.rejectionReason,
          posterUrl: item.campaign.posterUrl,
          teaserUrl: item.campaign.teaserUrl,
        },
        flags: item.flags,
      })),
    };
    return listCampaignModerationQueueResponseSchema.parse(payload);
  }

  @StaffAction("campaign_moderation.approve")
  @Authorize({ kind: "moderation_item", action: "view" })
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Post(":campaignId/approve")
  async approve(
    @Param("campaignId") campaignId: string,
    @Body() body: ApproveCampaignModerationDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const pending = await this.drafts.findByIdAnyBusiness(campaignId);
    if (pending === null) {
      throw mapStudioErrorToHttpException({ type: "campaign_not_found", campaignId });
    }

    const authz = await this.pdp.requireAction(
      principal,
      {
        kind: "moderation_item",
        id: campaignId,
        attr: { businessId: pending.businessId, hasReason: body.reason.trim().length > 0 },
      },
      "approve",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const result = await approveCampaignModeration(
      {
        drafts: this.drafts,
        bank: this.bank,
        rewardConfigs: this.rewardConfigs,
        termsVersions: this.termsVersions,
        publisher: this.publisher,
      },
      campaignId,
      { audience: body.audience, contentCategory: body.contentCategory },
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "campaign",
      targetId: campaignId,
      region: result.value.region,
      reason: body.reason,
      detail: { audience: result.value.audience, contentCategory: result.value.contentCategory },
    });
    return result.value;
  }

  @StaffAction("campaign_moderation.reject")
  @Authorize({ kind: "moderation_item", action: "view" })
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Post(":campaignId/reject")
  async reject(
    @Param("campaignId") campaignId: string,
    @Body() body: RejectCampaignModerationDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const pending = await this.drafts.findByIdAnyBusiness(campaignId);
    if (pending === null) {
      throw mapStudioErrorToHttpException({ type: "campaign_not_found", campaignId });
    }

    const authz = await this.pdp.requireAction(
      principal,
      {
        kind: "moderation_item",
        id: campaignId,
        attr: { businessId: pending.businessId, hasReason: body.reason.trim().length > 0 },
      },
      "reject",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const result = await rejectCampaignModeration(
      {
        drafts: this.drafts,
        bank: this.bank,
        rewardConfigs: this.rewardConfigs,
        termsVersions: this.termsVersions,
        publisher: this.publisher,
      },
      campaignId,
      body.reason,
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "campaign",
      targetId: campaignId,
      region: result.value.region,
      reason: body.reason,
    });
    return result.value;
  }
}
