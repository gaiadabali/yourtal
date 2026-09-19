import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import {
  coverageFraction,
  coveredSeconds,
  mergeCoverage,
  uncoveredGaps,
} from "@yourtal/contracts/watch/coverage";
import { describeRefusal, judgeProgressReport } from "@yourtal/contracts/watch/progress-report";
import type { WatchSession } from "@yourtal/contracts/watch/session";
import { describeCompletionRefusal, judgeCompletion } from "@yourtal/contracts/watch/session";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { CAMPAIGN_REPOSITORY } from "../campaign/persistence/campaign.repository";
import type { CampaignRepository } from "../campaign/persistence/campaign.repository";
import { WATCH_SESSION_REPOSITORY } from "./persistence/drizzle-watch-session.repository";
import type { WatchSessionRepository } from "./persistence/drizzle-watch-session.repository";

const startBody = z.object({ campaignId: z.uuid() });
const progressBody = z.object({
  fromSeconds: z.number().min(0),
  toSeconds: z.number().min(0),
  reportedAt: z.iso.datetime(),
});

/** A day. A watch session is resumable while its campaign runs; a retry is not. */
const SESSION_START_RETENTION_MS = 24 * 60 * 60 * 1_000;

/**
 * Watch sessions. YT-0553, enforcing O-1 and O-4 server-side.
 *
 * ## The client reports; it does not conclude
 *
 * There is no endpoint that accepts "I finished". `complete` re-reads the
 * recorded coverage and decides — the request is a question, not an
 * assertion. That is the whole of decision O-4: completion is playback
 * coverage, never where a playhead sits, and risk 43 exists because a player
 * spec had asserted the opposite and passed only because Chrome declines to
 * fire `ended` on a seek.
 *
 * A client that POSTs `complete` immediately after starting gets a refusal
 * naming how many seconds are still unwatched. A client that scrubs to the
 * end and POSTs gets the same refusal, because scrubbing covers nothing.
 */
@Controller("api/watch/sessions")
export class WatchController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(WATCH_SESSION_REPOSITORY) private readonly sessions: WatchSessionRepository,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
  ) {}

  @Authorize({ kind: "campaign_view", action: "earn" })
  @Idempotent({ retentionMs: SESSION_START_RETENTION_MS })
  @Post()
  async start(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = startBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("A campaignId is required to start watching.");
    }

    const campaign = await this.campaigns.findVisibleById(parsed.data.campaignId);
    if (campaign === null) {
      throw new NotFoundException("No such campaign.");
    }
    // `live`, not merely visible. A paused campaign stays readable so nobody
    // mid-watch is stranded, but starting a NEW attempt against one would
    // promise a reward it is not currently paying.
    if (!(await this.campaigns.isLive(parsed.data.campaignId))) {
      throw new ForbiddenException("This campaign is not currently running.");
    }

    const termsVersion = await this.campaigns.currentTermsVersion(parsed.data.campaignId);
    if (termsVersion === null) {
      // Refuse rather than default to 1. A session whose terms cannot be
      // named is one where "what you were promised" has no answer.
      throw new ForbiddenException("This campaign has no published terms to watch under.");
    }

    const session = await this.sessions.start(
      this.principals.resolve(request).id,
      parsed.data.campaignId,
      termsVersion,
    );
    return { session, durationSeconds: campaign.durationSeconds };
  }

  @Authorize({ kind: "campaign_view", action: "resume_session" })
  @NotValueMoving("A read. Resuming reports what was already recorded.")
  @Get(":sessionId")
  async resume(@Req() request: FastifyRequest, @Param("sessionId") sessionId: string) {
    const { session, durationSeconds } = await this.loadOwnSession(request, sessionId);
    const coverage = await this.sessions.coverageFor(session.id);

    return {
      session,
      durationSeconds,
      coverage: mergeCoverage(coverage),
      coveredSeconds: coveredSeconds(coverage),
      fraction: coverageFraction(coverage, durationSeconds),
      // What is still missing, so a client can resume at the first gap
      // rather than at a stored "position" that says nothing about whether
      // the middle was watched.
      gaps: uncoveredGaps(coverage, durationSeconds),
    };
  }

  @Authorize({ kind: "campaign_view", action: "earn" })
  @NotValueMoving(
    "Records watched seconds. Moves no value: a replayed span merges into coverage already held, and completion is decided separately by reading that coverage.",
  )
  @Post(":sessionId/progress")
  async progress(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    const parsed = progressBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "A progress report needs fromSeconds, toSeconds and reportedAt.",
      );
    }

    const { session, durationSeconds } = await this.loadOwnSession(request, sessionId);
    if (session.state !== "active") {
      throw new ForbiddenException(`This session is ${session.state}.`);
    }

    const now = new Date();
    const verdict = judgeProgressReport(
      { sessionId: session.id, ...parsed.data },
      {
        // The SERVER's clocks, both of them. `reportedAt` is recorded for
        // audit and never used here: a client that could supply the
        // reference time could claim any span it liked.
        previousServerMs: new Date(session.lastProgressAt).getTime(),
        nowServerMs: now.getTime(),
        durationSeconds,
      },
    );

    if (!verdict.accepted) {
      throw new BadRequestException(describeRefusal(verdict.reason));
    }

    await this.sessions.recordCoverage(session.id, verdict.interval, now);
    const coverage = await this.sessions.coverageFor(session.id);
    return {
      accepted: true,
      coveredSeconds: coveredSeconds(coverage),
      fraction: coverageFraction(coverage, durationSeconds),
    };
  }

  @Authorize({ kind: "campaign_view", action: "watch_rewarded" })
  @Idempotent({ retentionMs: SESSION_START_RETENTION_MS })
  @Post(":sessionId/complete")
  async complete(@Req() request: FastifyRequest, @Param("sessionId") sessionId: string) {
    const { session, durationSeconds } = await this.loadOwnSession(request, sessionId);
    const coverage = await this.sessions.coverageFor(session.id);

    const verdict = judgeCompletion({
      session,
      coverage,
      durationSeconds,
      // TODO(YT-0122): the question bank is not built, so nothing can have
      // been answered. Hard-coded FALSE rather than true: a placeholder that
      // lets completion through would be a reward path nobody meant to open,
      // and O-1 requires both halves. This endpoint therefore refuses every
      // completion today, which is the correct behaviour until questions
      // exist — and the refusal says so.
      questionsAnswered: false,
      campaignIsLive: await this.campaigns.isLive(session.campaignId),
    });

    if (verdict !== "earned") {
      throw new ForbiddenException(describeCompletionRefusal(verdict));
    }

    await this.sessions.markCompleted(session.id, new Date());
    return { completed: true };
  }

  /**
   * Loads a session that belongs to the caller, with its campaign's duration.
   *
   * Ownership is checked here rather than by the PDP because it is not a
   * policy question: no role makes someone else's watch session yours. The
   * PDP answers "may this principal earn at all"; this answers "is this
   * theirs", and conflating the two would put a row-level fact into a policy
   * file that cannot see rows.
   *
   * A session belonging to someone else is a 404, not a 403 — a 403 confirms
   * the id exists.
   */
  private async loadOwnSession(
    request: FastifyRequest,
    sessionId: string,
  ): Promise<{ session: WatchSession; durationSeconds: number }> {
    const session = await this.sessions.findById(sessionId);
    if (session === null || session.userId !== this.principals.resolve(request).id) {
      throw new NotFoundException("No such watch session.");
    }

    const campaign = await this.campaigns.findVisibleById(session.campaignId);
    if (campaign === null) {
      throw new NotFoundException("The campaign for this session is no longer available.");
    }
    return { session, durationSeconds: campaign.durationSeconds };
  }
}
