import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { REGION_SETTINGS_READER } from "../../../shared/settings/region-settings-reader";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import { CAMPAIGN_REPOSITORY } from "../../campaign/persistence/campaign.repository";
import type { CampaignRepository } from "../../campaign/persistence/campaign.repository";
import { mintManifestUrl } from "../media/mint-manifest-url";
import { MANIFEST_SIGNING_SECRET } from "../media/manifest-signing-secret";
import { hashRequestIp } from "./ip-hash";
import { readOpenViewingLimits } from "./open-viewing-limits";
import { OPEN_VIEW_SESSION_REPOSITORY } from "./open-view-session.repository";
import type { OpenViewSessionRepository } from "./open-view-session.repository";

const startBody = z.object({ campaignId: z.uuid() });
// `campaignId` here is NOT read for the mutation itself (the session row,
// found by sessionId + ipHash, already knows its own campaign) — it exists
// so `CampaignViewAttributeLoader` has one to resolve for Cerbos, the same
// way `startBody` supplies it. See this controller's own header for why
// the path param is deliberately `openViewSessionId`, not `sessionId`.
const progressBody = z.object({
  campaignId: z.uuid(),
  fromSeconds: z.number().min(0),
  toSeconds: z.number().min(0),
});

/**
 * Open Viewing's anonymous watch session (TASKS.md 11.2.b, docs/17 section
 * 4). A deliberately separate controller from `WatchController` — the
 * anonymous path must never come near `watch.session`, the ledger hold, or
 * the reward grant, and keeping it in its own file makes "never touches the
 * ledger" true by construction rather than by care.
 *
 * `campaign_view.yaml`'s `open-viewing-is-opt-in-and-funded` rule already
 * gates this to a live, `openViewingEnabled`, funded, `all_ages` campaign
 * for the `anonymous` role (`CampaignViewAttributeLoader` supplies the
 * attributes) — the same `watch_open` action `CampaignController` already
 * uses for its anonymous reads. This controller adds the two things Cerbos
 * cannot see: the F12 per-IP daily minute cap and the one-concurrent-session
 * rule, both region-scoped settings (`open-viewing-limits.ts`), never a
 * hard-coded number.
 */
@Controller("api/watch/open-view-sessions")
export class OpenViewSessionController {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(OPEN_VIEW_SESSION_REPOSITORY) private readonly sessions: OpenViewSessionRepository,
    @Inject(REGION_SETTINGS_READER) private readonly settings: RegionSettingsReader,
    @Inject(MANIFEST_SIGNING_SECRET) private readonly manifestSigningSecret: string,
  ) {}

  @Authorize({ kind: "campaign_view", action: "watch_open" })
  @NotValueMoving(
    "Anonymous and non-earning by construction: this route never reads or writes the ledger, " +
      "and watch.open_view_session is a separate table from the reward-bearing watch.session. " +
      "A replay just starts (or resumes) another anonymous view.",
  )
  @RateLimit({ routeId: "open-view.start", ip: { max: 20, windowSeconds: 60 } })
  @Post()
  async start(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = startBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("A campaignId is required to start an open view.");
    }

    const campaign = await this.campaigns.findVisibleById(parsed.data.campaignId);
    if (campaign === null) {
      throw new NotFoundException("No such campaign.");
    }
    // Defence in depth alongside the Cerbos rule (which already checks
    // `openViewingEnabled` + funding): F8 requires an all_ages rating too,
    // and Studio's own `category-policy.ts` already refuses to enable Open
    // Viewing on anything else, so this should be structurally impossible —
    // but a session that could ever mint a signed manifest URL for an
    // adult-rated campaign is exactly the kind of bug worth refusing twice.
    if (!campaign.openViewing || campaign.audience !== "all_ages" || campaign.status !== "active") {
      throw new ForbiddenException("This campaign is not open for anonymous viewing.");
    }

    const ipHash = hashRequestIp(request);
    const limits = await readOpenViewingLimits(this.settings, campaign.region);

    const existingForCampaign = await this.sessions.findActiveForIpAndCampaign(
      ipHash,
      campaign.id,
    );
    if (existingForCampaign === null) {
      const watchedToday = await this.sessions.watchedSecondsToday(ipHash, campaign.region);
      if (watchedToday >= limits.dailySeconds) {
        throw new ForbiddenException(
          "You've reached today's anonymous viewing limit. Sign in to keep watching.",
        );
      }
      const activeCount = await this.sessions.countActiveForIp(ipHash);
      if (activeCount >= limits.maxConcurrentSessions) {
        throw new ForbiddenException(
          "Only one anonymous viewing session at a time. Sign in to watch on more than one.",
        );
      }
    }

    const session =
      existingForCampaign ??
      (await this.sessions.create({
        campaignId: campaign.id,
        region: campaign.region,
        ipHash,
      }));

    return {
      sessionId: session.id,
      durationSeconds: campaign.durationSeconds,
      manifestUrl: mintManifestUrl({
        secret: this.manifestSigningSecret,
        hlsUrl: campaign.hlsUrl,
        sessionId: session.id,
        durationSeconds: campaign.durationSeconds,
      }),
    };
  }

  /**
   * The path param is deliberately NOT `:sessionId` — `CampaignViewAttributeLoader`
   * special-cases that exact name and looks it up in the REWARDED
   * `watch.session` table (`WATCH_SESSION_REPOSITORY`), which this anonymous
   * session never appears in. Naming it `openViewSessionId` instead makes
   * the loader fall through to its body-parsing branch, which reads
   * `campaignId` from `progressBody` — the same shape `start`'s own body
   * already carries — so Cerbos re-checks this exact route the same way
   * every other `campaign_view` route does, with no change to that shared
   * loader.
   */
  @Authorize({ kind: "campaign_view", action: "watch_open" })
  @NotValueMoving("Records anonymous watched seconds only; never touches the ledger.")
  // `ip`, not `identity`: every caller here is anonymous by definition, so
  // `identity` would never have anything to key on (rate-limit.guard.ts's
  // own doc comment).
  @RateLimit({ routeId: "open-view.progress", ip: { max: 120, windowSeconds: 60 } })
  @Post(":openViewSessionId/progress")
  async progress(
    @Req() request: FastifyRequest,
    @Param("openViewSessionId") openViewSessionId: string,
    @Body() body: unknown,
  ) {
    const parsed = progressBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("A progress report needs campaignId, fromSeconds and toSeconds.");
    }
    const ipHash = hashRequestIp(request);
    const session = await this.sessions.findByIdForIp(openViewSessionId, ipHash);
    if (session === null || session.campaignId !== parsed.data.campaignId) {
      throw new NotFoundException("No such open-view session for this caller.");
    }
    const delta = parsed.data.toSeconds - parsed.data.fromSeconds;
    const updated = await this.sessions.addProgress(openViewSessionId, delta);
    return { accepted: true, watchedSeconds: updated.watchedSeconds };
  }
}
