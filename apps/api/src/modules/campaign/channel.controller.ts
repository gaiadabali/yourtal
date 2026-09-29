import { Controller, Get, Inject, NotFoundException, Param, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { resolveCatalogueScope } from "../store/catalogue-scope";
import { LISTING_REPOSITORY } from "../store/persistence/listing.repository";
import type { ListingRepository } from "../store/persistence/listing.repository";
import { CAMPAIGN_REPOSITORY } from "./persistence/campaign.repository";
import type { CampaignRepository } from "./persistence/campaign.repository";
import { CHANNEL_LOOKUP_REPOSITORY } from "./persistence/channel-lookup.repository";
import type {
  ChannelLookupRepository,
  ChannelSummary,
} from "./persistence/channel-lookup.repository";

const CAMPAIGN_LIMIT = 30;
const LISTING_LIMIT = 20;

/**
 * 11.5.d: the channel page (`/c/[handle]`, in-app) and the watch page's
 * channel row (by `businessId`, since that is all a `Campaign` carries) --
 * one business's own public page: cover/logo, its still-live campaigns and
 * its own store listings. Same `campaign_view`/`watch_open` action as
 * `CampaignController` -- a channel page is public browse for exactly the
 * same reason a campaign page is, and asking a real per-item Cerbos
 * question here would need attributes (per-campaign state/openViewing/
 * budget) this list-shaped read has no single resource to hang them on, the
 * same finding `CampaignController`'s own header already made.
 */
@Controller("api/channels")
export class ChannelController {
  constructor(
    @Inject(CHANNEL_LOOKUP_REPOSITORY) private readonly channels: ChannelLookupRepository,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository,
    private readonly principals: AsyncPrincipalResolver,
  ) {}

  @Authorize({ kind: "campaign_view", action: "watch_open" })
  @NotValueMoving("A read.")
  @Get(":handle")
  async byHandle(@Param("handle") handle: string, @Req() request: FastifyRequest) {
    const channel = await this.channels.findByHandle(handle);
    if (channel === null) {
      throw new NotFoundException("No such channel.");
    }
    return this.assemble(channel, request);
  }

  @Authorize({ kind: "campaign_view", action: "watch_open" })
  @NotValueMoving("A read.")
  @Get("by-business/:businessId")
  async byBusinessId(@Param("businessId") businessId: string, @Req() request: FastifyRequest) {
    const channel = await this.channels.findById(businessId);
    if (channel === null) {
      throw new NotFoundException("No such channel.");
    }
    return this.assemble(channel, request);
  }

  private async assemble(channel: ChannelSummary, request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    // The channel's OWN region is always the ground truth here (never a
    // query param) -- a signed-in visitor from the other region still sees
    // the page (browsing is not a money-moving action F2 needs to wall),
    // just with the least specific ("all_ages") audience reach, same as an
    // anonymous visitor.
    const scope = resolveCatalogueScope(principal, channel.region);
    const audiences = scope.kind === "ok" ? scope.audiences : (["all_ages"] as const);

    const [campaigns, listingPage] = await Promise.all([
      this.campaigns.listVisibleByBusiness(channel.businessId, CAMPAIGN_LIMIT),
      this.listings.browsePublic({
        region: channel.region,
        audiences,
        merchantId: channel.businessId,
        limit: LISTING_LIMIT,
      }),
    ]);

    return { channel, campaigns, listings: listingPage.listings };
  }
}
