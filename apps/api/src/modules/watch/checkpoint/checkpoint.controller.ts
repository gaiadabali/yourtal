import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { CHECKPOINT_TOKEN_TTL_MS } from "@yourtal/contracts/watch/checkpoint-token";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { Idempotent } from "../../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../../shared/authz/principal-resolver";
import { CAMPAIGN_REPOSITORY } from "../../campaign/persistence/campaign.repository";
import type { CampaignRepository } from "../../campaign/persistence/campaign.repository";
import { WATCH_SESSION_REPOSITORY } from "../persistence/drizzle-watch-session.repository";
import type { WatchSessionRepository } from "../persistence/drizzle-watch-session.repository";
import { CheckpointService } from "./checkpoint.service";

/**
 * Issuing checkpoint tokens. YT-0121.
 *
 * ## A separate controller, beside `WatchController` rather than inside it
 *
 * `WatchController` is YT-0553 and sits at `review` with every criterion
 * ticked, waiting on a verifier. A ticket pending verification must not move
 * underneath the person verifying it — they cannot tell a concurrent write
 * from established state, and would end up certifying this ticket's work as
 * that one's, or failing criteria that were true when they were ticked. So
 * these endpoints are added alongside, and nothing in `watch.controller.ts`
 * is touched.
 *
 * ## Why issuance is `@Idempotent` and not `@NotValueMoving`
 *
 * Issuing looks like a read — it creates no reward and moves no points — and
 * the AC settles it the other way: *"per-checkpoint signed single-use token;
 * nonce burned"*. **Single-use means issuing consumes the attempt.** A
 * retried issue either hands the viewer two live nonces for one checkpoint,
 * or burns the first and voids a token already in flight on a slow network.
 * Both are value-moving in a system where a checkpoint stands between a
 * viewer and their reward, so a retry must replay the original response
 * rather than mint a second token.
 */
@Controller("api/watch/sessions")
export class CheckpointController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    private readonly checkpoints: CheckpointService,
    @Inject(WATCH_SESSION_REPOSITORY) private readonly sessions: WatchSessionRepository,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
  ) {}

  @Authorize({ kind: "campaign_view", action: "earn" })
  @Idempotent({ retentionMs: CHECKPOINT_TOKEN_TTL_MS })
  @Post(":sessionId/checkpoints/:checkpointIndex/token")
  async issue(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Param("checkpointIndex") rawIndex: string,
  ) {
    const checkpointIndex = Number(rawIndex);
    if (!Number.isInteger(checkpointIndex) || checkpointIndex < 0) {
      throw new BadRequestException("A checkpoint index is a whole number from zero.");
    }

    const session = await this.sessions.findById(sessionId);
    // Someone else's session is a 404, not a 403. A 403 confirms the id
    // exists, which is the same enumeration discipline `loadOwnSession`
    // applies in `watch.controller.ts` and YT-0153 applies to vouchers.
    if (session === null || session.userId !== (await this.principals.resolve(request)).id) {
      throw new NotFoundException("No such watch session.");
    }
    if (session.state !== "active") {
      // A superseded or completed session must not mint new checkpoints.
      // Without this, a viewer who finished could keep answering questions
      // against a session whose reward has already been decided.
      throw new ForbiddenException("This watch session is no longer active.");
    }

    const campaign = await this.campaigns.findVisibleById(session.campaignId);
    if (campaign === null) {
      throw new NotFoundException("The campaign for this session is no longer available.");
    }

    // The schedule is the authority on how many checkpoints exist. Asking
    // for index 40 of a four-checkpoint video is refused here rather than
    // signed — a token for a checkpoint that does not exist could never be
    // answered, but it would still burn a nonce and occupy the
    // one-answer-per-checkpoint slot for an index nothing will ever reach.
    const schedule = this.checkpoints.schedule(
      sessionId,
      campaign.durationSeconds,
      campaign.questionCount,
    );
    if (checkpointIndex >= schedule.length) {
      throw new NotFoundException("No such checkpoint in this session.");
    }

    const issued = this.checkpoints.issue(sessionId, checkpointIndex, Date.now());
    return {
      token: issued.token,
      expiresAt: new Date(issued.expiresAtMs).toISOString(),
      // The time the checkpoint falls at, so the player knows when to ask.
      // Sent only for the index requested — handing over the whole schedule
      // would tell a client every future checkpoint, which is precisely the
      // predictability the PRF exists to deny it.
      atSecond: schedule[checkpointIndex],
    };
  }
}
