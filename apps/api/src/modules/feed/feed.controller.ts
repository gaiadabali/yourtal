import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { CAMPAIGN_REPOSITORY } from "../campaign/persistence/campaign.repository";
import type { CampaignRepository } from "../campaign/persistence/campaign.repository";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { LISTING_REPOSITORY } from "../store/persistence/listing.repository";
import type { ListingRepository } from "../store/persistence/listing.repository";
import { REGION_SETTINGS_READER } from "../../shared/settings/region-settings-reader";
import type { RegionSettingsReader } from "../../shared/settings/region-settings-reader";
import { FEED_SIGNALS_REPOSITORY } from "./persistence/feed-signals.repository";
import type { FeedSignalsRepository } from "./persistence/feed-signals.repository";
import { PACING_STATE_REPOSITORY } from "./persistence/pacing-state.repository";
import type { PacingStateRepository } from "./persistence/pacing-state.repository";
import { CHANNEL_SEARCH_REPOSITORY } from "./persistence/channel-search.repository";
import type { ChannelSearchRepository } from "./persistence/channel-search.repository";
import { SUSPENDED_BUSINESS_LOOKUP } from "./persistence/suspended-business-lookup";
import type { SuspendedBusinessLookup } from "./persistence/suspended-business-lookup";
import { feedQuerySchema } from "./dto/feed-query";
import { searchQuerySchema } from "./dto/search-query";
import { getFeed } from "./use-cases/get-feed.use-case";
import { search } from "./use-cases/search.use-case";
import { markNotInterested } from "./use-cases/not-interested.use-case";

/**
 * 7.7: feed, search and "not interested". No `:tenantId` -- this is the
 * consumer (Earn/watch) side, same as `StoreCatalogueController`, reachable
 * both signed in and anonymous. `@PublicRoute` for the same reason that
 * controller uses it (see its own doc comment): there is no consumer-facing
 * `feed`/`campaign_view`-as-a-list Cerbos resource a LIST route could ask a
 * real per-item question against (`campaign_view.yaml`'s ALLOW rules need
 * per-item state/openViewing/budget attrs a list check cannot supply --
 * confirmed empirically against the real PDP during this ticket). The
 * region/audience wall is enforced here in code instead, through
 * `catalogue-scope.ts`'s proven rule -- the session is still read and used,
 * never ignored.
 */
@Controller("api")
export class FeedController {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository,
    @Inject(PACING_STATE_REPOSITORY) private readonly pacing: PacingStateRepository,
    @Inject(FEED_SIGNALS_REPOSITORY) private readonly signals: FeedSignalsRepository,
    @Inject(REGION_SETTINGS_READER) private readonly settings: RegionSettingsReader,
    @Inject(CHANNEL_SEARCH_REPOSITORY) private readonly channels: ChannelSearchRepository,
    @Inject(SUSPENDED_BUSINESS_LOOKUP)
    private readonly suspendedBusinesses: SuspendedBusinessLookup,
    private readonly principals: AsyncPrincipalResolver,
  ) {}

  @PublicRoute(
    "The feed is public browse, same shape as the store catalogue: reachable signed in or " +
      "anonymous, walled by catalogue-scope.ts rather than a per-item Cerbos check a list route cannot make.",
  )
  @NotValueMoving("A read.")
  @Get("feed")
  async feed(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
  ) {
    const parsed = feedQuerySchema.parse(query);
    const principal = await this.principals.resolve(request);
    const result = await getFeed(
      this.campaigns,
      this.ledger,
      this.pacing,
      this.signals,
      this.settings,
      this.suspendedBusinesses,
      principal,
      parsed.surface,
      parsed.region,
    );
    if (result.kind === "region_required") {
      throw new BadRequestException({
        code: "region_required",
        message: "an anonymous request must state a region query param",
      });
    }
    return result.result;
  }

  @PublicRoute(
    "Search covers the same public surface as the feed and the store catalogue, one query string.",
  )
  @NotValueMoving("A read.")
  @Get("search")
  async searchAll(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
  ) {
    const parsed = searchQuerySchema.parse(query);
    const principal = await this.principals.resolve(request);
    const result = await search(
      this.campaigns,
      this.ledger,
      this.channels,
      this.listings,
      this.suspendedBusinesses,
      principal,
      parsed.q,
      parsed.region,
    );
    if (result.kind === "region_required") {
      throw new BadRequestException({
        code: "region_required",
        message: "an anonymous request must state a region query param",
      });
    }
    return result.result;
  }

  @PublicRoute(
    "Reachable anonymous like the rest of this controller, but demote() is a no-op for the " +
      "anonymous principal id -- there is no per-viewer row to write without a session.",
  )
  @NotValueMoving(
    "Naturally idempotent: feed.demotion's own composite primary key (user_id, campaign_id) " +
      "and an ON CONFLICT DO NOTHING upsert mean a retry writes nothing a user would notice twice.",
  )
  @Post("feed/:campaignId/not-interested")
  async notInterested(@Param("campaignId") campaignId: string, @Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    if (principal.id !== "anonymous") {
      await markNotInterested(this.signals, principal.id, campaignId);
    }
    return { ok: true };
  }
}
