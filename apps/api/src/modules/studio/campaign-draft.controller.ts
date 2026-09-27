import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { BUSINESS_ACCOUNT_REPOSITORY } from "../business/persistence/business-account.repository";
import type { BusinessAccountRepository } from "../business/persistence/business-account.repository";
import { CreateCampaignDraftDto } from "./dto/create-campaign-draft.schema";
import { UpdateCampaignDraftDto } from "./dto/update-campaign-draft.schema";
import { CAMPAIGN_DRAFT_REPOSITORY } from "./persistence/campaign-draft.repository";
import type { CampaignDraftRepository } from "./persistence/campaign-draft.repository";
import { REWARD_CONFIG_REPOSITORY } from "./persistence/reward-config.repository";
import type { RewardConfigRepository } from "./persistence/reward-config.repository";
import { TERMS_VERSION_REPOSITORY } from "./persistence/terms-version.repository";
import type { TermsVersionRepository } from "./persistence/terms-version.repository";
import { CAMPAIGN_PUBLISHED_PUBLISHER } from "./campaign-published-publisher";
import type { CampaignPublishedPublisher } from "./campaign-published-publisher";
import { createCampaignDraft } from "./use-cases/create-campaign-draft.use-case";
import { getCampaignDraft, listCampaignDrafts } from "./use-cases/get-campaign-draft.use-case";
import { updateCampaignDraft } from "./use-cases/update-campaign-draft.use-case";
import { submitCampaign } from "./use-cases/submit-campaign.use-case";
import { mapStudioErrorToHttpException } from "./to-http-exception";

/**
 * TASKS.md 7.3.a/7.3.d: draft CRUD and submission. Every route asks the PDP
 * about the ALREADY-BUILT `campaign` resource kind
 * (`policies/resource_policies/campaign.yaml`, `packages/authz/src/
 * resources.ts`) — nothing new to authorize here, only new callers of an
 * existing, tested policy.
 */
@Controller("api/:tenantId/studio/campaigns")
export class CampaignDraftController {
  constructor(
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(CAMPAIGN_DRAFT_REPOSITORY) private readonly drafts: CampaignDraftRepository,
    @Inject(REWARD_CONFIG_REPOSITORY) private readonly rewardConfigs: RewardConfigRepository,
    @Inject(TERMS_VERSION_REPOSITORY) private readonly termsVersions: TermsVersionRepository,
    @Inject(CAMPAIGN_PUBLISHED_PUBLISHER) private readonly publisher: CampaignPublishedPublisher,
  ) {}

  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Authorize({ kind: "campaign", action: "create" })
  @Post()
  async create(@Param("tenantId") tenantId: string, @Body() body: CreateCampaignDraftDto) {
    const result = await createCampaignDraft(
      { businesses: this.businesses, drafts: this.drafts },
      {
        businessId: tenantId,
        kind: body.kind,
        title: body.title,
        synopsis: body.synopsis,
        durationSeconds: body.durationSeconds,
        contentCategory: body.contentCategory,
        audience: body.audience,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        openViewing: body.openViewing,
        teaserStartSeconds: body.teaserStartSeconds,
        declaredInterests: body.declaredInterests,
      },
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "campaign", action: "view" })
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listCampaignDrafts(this.drafts, tenantId);
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({
    kind: "campaign",
    action: "view",
    idFrom: (request) => paramOf(request, "campaignId"),
  })
  @Get(":campaignId")
  async get(@Param("tenantId") tenantId: string, @Param("campaignId") campaignId: string) {
    const result = await getCampaignDraft(this.drafts, tenantId, campaignId);
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving(
    "A patch that repeats the same fields ends at the same row — nothing to duplicate.",
  )
  @Authorize({
    kind: "campaign",
    action: "edit",
    idFrom: (request) => paramOf(request, "campaignId"),
  })
  @Patch(":campaignId")
  async update(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
    @Body() body: UpdateCampaignDraftDto,
  ) {
    const result = await updateCampaignDraft(this.drafts, tenantId, campaignId, body);
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving(
    "A retry after the first call already moved the campaign to in_review reports " +
      "illegal_transition (already past draft) -- a safe, non-duplicating outcome, never a second submission.",
  )
  @Authorize({
    kind: "campaign",
    action: "submit_for_review",
    idFrom: (request) => paramOf(request, "campaignId"),
  })
  @Post(":campaignId/submit")
  async submit(@Param("tenantId") tenantId: string, @Param("campaignId") campaignId: string) {
    const result = await submitCampaign(
      {
        businesses: this.businesses,
        drafts: this.drafts,
        rewardConfigs: this.rewardConfigs,
        termsVersions: this.termsVersions,
        publisher: this.publisher,
      },
      tenantId,
      campaignId,
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }
}

/** `idFrom` is typed to always return a string (unlike `attrsFrom`'s per-field optionality) -- an absent param reads as an empty resource id, which no `findById` ever matches, rather than `undefined` falling through as "no id filter". */
function paramOf(request: FastifyRequest, name: string): string {
  const params: unknown = request.params;
  if (typeof params !== "object" || params === null) return "";
  const value: unknown = Reflect.get(params, name);
  return typeof value === "string" ? value : "";
}
