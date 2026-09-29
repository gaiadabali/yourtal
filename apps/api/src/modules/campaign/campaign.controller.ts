import { Controller, Get, Inject, NotFoundException, Param, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { reachableAudiences } from "@yourtal/contracts/audience/audience";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { CAMPAIGN_REPOSITORY } from "./persistence/campaign.repository";
import type { CampaignRepository } from "./persistence/campaign.repository";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * Campaign reads for the Earn board and the entry card. YT-0553.
 *
 * The same three-step shape every controller in this app uses: the
 * `@Authorize` decorator names one action on one resource, `PdpGuard`
 * enforces it, and the method calls one repository. YT-0500 replaces the
 * middle step without moving a call site.
 *
 * `campaign_view` is the consumer-facing resource kind (docs/17 section 4),
 * not `campaign` — that one is the advertiser's management surface and
 * carries `edit`, `publish` and `view_performance`. A viewer asking to watch
 * something must never be answered by a policy written about authoring it.
 *
 * **The authoring state cannot reach these responses.** The repository
 * returns `Campaign`, whose `status` has no value capable of expressing
 * `draft` — so it is unrepresentable rather than filtered.
 */
@Controller("api/campaigns")
export class CampaignController {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    // Typed as the narrow interface, not the concrete class, for the same
    // reason `store-listing.controller.ts` types its own principal field as
    // `PrincipalResolver` -- `AsyncPrincipalResolver` has private fields, so
    // a duck-typed `{ resolve: async () => ... }` fake could not otherwise
    // satisfy it without a cast. Nest still resolves the real class by
    // token (`@Inject`), since DI needs a concrete provider either way.
    @Inject(AsyncPrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Authorize({ kind: "campaign_view", action: "watch_open" })
  @NotValueMoving("A read. Nothing is created, so a replay has nothing to duplicate.")
  @Get()
  async list(@Query("limit") limit: string | undefined, @Req() request: FastifyRequest) {
    // Clamped, not trusted. `?limit=1000000` is a denial-of-service with no
    // authentication required, and a default that a caller can raise without
    // bound is not a default.
    const requested = Number.parseInt(limit ?? "", 10);
    const safeLimit = Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // 12.1.b: this route names no single campaign
    // (`CampaignViewAttributeLoader`'s own doc comment), so Cerbos's
    // per-resource audience wall cannot filter it -- the list itself has to.
    // `reachableAudiences` is the same truth table `catalogue-scope.ts`
    // derives from, so this list and the store catalogue's agree by
    // construction rather than by two people remembering to match wording.
    const principal = await this.principals.resolve(request);
    const audiences = reachableAudiences(principal.attr.ageBand);

    return { campaigns: await this.campaigns.listVisible(safeLimit, audiences) };
  }

  @Authorize({ kind: "campaign_view", action: "watch_open" })
  @NotValueMoving("A read.")
  @Get(":campaignId")
  async get(@Param("campaignId") campaignId: string) {
    const campaign = await this.campaigns.findVisibleById(campaignId);
    if (campaign === null) {
      // 404 for both "does not exist" and "not public yet", deliberately.
      // Distinguishing them tells an outsider that a draft with that id
      // exists, which is a disclosure dressed as helpfulness.
      throw new NotFoundException("No such campaign.");
    }
    return campaign;
  }

  /**
   * The terms currently in force (11.5.a): the same frozen numbers a watch
   * session would enter under (`rewardPoints`, `accuracyBonusPoints`,
   * `questionCount`, `durationSeconds`), so the campaign page's terms card
   * shows absolute points rather than re-deriving them from a ratio.
   * `findVisibleById` first, same as `get`, so a draft's terms are exactly as
   * invisible as the draft itself.
   */
  @Authorize({ kind: "campaign_view", action: "watch_open" })
  @NotValueMoving("A read.")
  @Get(":campaignId/terms")
  async terms(@Param("campaignId") campaignId: string) {
    const campaign = await this.campaigns.findVisibleById(campaignId);
    if (campaign === null) {
      throw new NotFoundException("No such campaign.");
    }
    const version = await this.campaigns.currentTermsVersion(campaignId);
    if (version === null) {
      throw new NotFoundException("This campaign has no published terms.");
    }
    const terms = await this.campaigns.termsVersionDetails(campaignId, version);
    if (terms === null) {
      throw new NotFoundException("This campaign has no published terms.");
    }
    return terms;
  }
}
