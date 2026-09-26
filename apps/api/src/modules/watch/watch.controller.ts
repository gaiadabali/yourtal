import {
  BadRequestException,
  Body,
  ConflictException,
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
import { describeRefusal } from "@yourtal/contracts/watch/progress-report";
import type { WatchSession } from "@yourtal/contracts/watch/session";
import { describeCompletionRefusal, judgeCompletion } from "@yourtal/contracts/watch/session";
import { pointsForCompletion } from "@yourtal/contracts/watch/reward-for-completion";
import { questionsAskedFor } from "@yourtal/contracts/question/question-bank";
import { checkpointSchedule } from "@yourtal/contracts/watch/checkpoint-token";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { signRewardAttestation } from "../../shared/ledger-client/reward-attestation";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { CAMPAIGN_REPOSITORY } from "../campaign/persistence/campaign.repository";
import type { CampaignRepository } from "../campaign/persistence/campaign.repository";
import { WATCH_SESSION_REPOSITORY } from "./persistence/drizzle-watch-session.repository";
import type { WatchSessionRepository } from "./persistence/drizzle-watch-session.repository";
import { REWARD_ATTESTATION_SECRET } from "./reward-attestation-secret";
import { CHECKPOINT_SECRET } from "./checkpoint/checkpoint.service";
import { stubSegmentUrl } from "./media/segment-url-stub";
import { DELIVERY_COVERAGE_READER } from "./delivery-coverage";
import type { DeliveryCoverageReader } from "./delivery-coverage";

const startBody = z.object({ campaignId: z.uuid() });
const progressBody = z.object({
  fromSeconds: z.number().min(0),
  toSeconds: z.number().min(0),
  reportedAt: z.iso.datetime(),
});

/** A day. A watch session is resumable while its campaign runs; a retry is not. */
const SESSION_START_RETENTION_MS = 24 * 60 * 60 * 1_000;

/** 4.4.e's own formula: twice the video's length, plus an hour of slack. */
function holdTtlSeconds(durationSeconds: number): number {
  return durationSeconds * 2 + 60 * 60;
}

/**
 * Watch sessions. YT-0553, enforcing O-1 and O-4 server-side. 5.1-5.3.
 *
 * ## The client reports; it does not conclude
 *
 * There is no endpoint that accepts "I finished". `complete` re-reads the
 * recorded coverage and decides — the request is a question, not an
 * assertion. That is the whole of decision O-4: completion is playback
 * coverage, never where a playhead sits.
 */
@Controller("api/watch/sessions")
export class WatchController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(WATCH_SESSION_REPOSITORY) private readonly sessions: WatchSessionRepository,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
    @Inject(REWARD_ATTESTATION_SECRET) private readonly attestationSecret: string,
    @Inject(CHECKPOINT_SECRET) private readonly checkpointSecret: string,
    @Inject(DELIVERY_COVERAGE_READER) private readonly delivery: DeliveryCoverageReader,
  ) {}

  @Authorize({ kind: "campaign_view", action: "earn" })
  @Idempotent({ retentionMs: SESSION_START_RETENTION_MS })
  @Post()
  async start(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = startBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("A campaignId is required to start watching.");
    }
    const campaignId = parsed.data.campaignId;

    const campaign = await this.campaigns.findVisibleById(campaignId);
    if (campaign === null) {
      throw new NotFoundException("No such campaign.");
    }
    // `live`, not merely visible. A paused campaign stays readable so nobody
    // mid-watch is stranded, but starting a NEW attempt against one would
    // promise a reward it is not currently paying (EW-19).
    if (!(await this.campaigns.isLive(campaignId))) {
      throw new ForbiddenException("This campaign is not currently running.");
    }

    const termsVersion = await this.campaigns.currentTermsVersion(campaignId);
    if (termsVersion === null) {
      throw new ForbiddenException("This campaign has no published terms to watch under.");
    }
    const terms = await this.campaigns.termsVersionDetails(campaignId, termsVersion);
    if (terms === null) {
      throw new ForbiddenException("This campaign's current terms could not be read.");
    }

    const userId = (await this.principals.resolve(request)).id;
    const { session: started, resumed } = await this.sessions.startOrResume({
      userId,
      campaignId,
      termsVersion,
    });

    if (!resumed) {
      const outcome = await this.decideEarningOutcome(
        userId,
        campaignId,
        started.id,
        terms.durationSeconds,
      );
      await this.sessions.finalizeEarningOutcome(started.id, outcome);
    }
    const session = (await this.sessions.findById(started.id)) ?? started;

    return {
      session,
      durationSeconds: terms.durationSeconds,
      alreadyEarned: session.nonEarningReason === "already_earned",
      // 5.1.d: a per-session manifest URL. Unsigned until `@yourtal/media`
      // exports `mintSegmentUrl` (7.2.c) — see the stub's own header.
      manifestUrl: stubSegmentUrl({
        baseUrl: originOf(campaign.hlsUrl),
        sessionId: session.id,
        assetId: campaignId,
      }),
    };
  }

  /** Decides `nonEarning`/`holdId` for a FRESH session. Never called on a resumed one. */
  private async decideEarningOutcome(
    userId: string,
    campaignId: string,
    sessionId: string,
    durationSeconds: number,
  ): Promise<{ nonEarning: boolean; nonEarningReason: string | null; holdId: string | null }> {
    if (await this.sessions.hasBeenGranted(userId, campaignId)) {
      return { nonEarning: true, nonEarningReason: "already_earned", holdId: null };
    }

    const rewardConfig = await this.campaigns.rewardConfigFor(campaignId);
    if (rewardConfig === null) {
      return { nonEarning: true, nonEarningReason: "no_funding_configured", holdId: null };
    }

    const held = await this.ledger.hold({
      allocationId: rewardConfig.allocationId,
      points: toPoints(rewardConfig.rewardPointsPerCompletion + rewardConfig.accuracyBonusPoints),
      sagaId: `watch-hold:${sessionId}`,
      ttlSeconds: holdTtlSeconds(durationSeconds),
    });
    if (held.isErr()) {
      return {
        nonEarning: true,
        nonEarningReason: describeLedgerRefusal(held.error),
        holdId: null,
      };
    }
    return { nonEarning: false, nonEarningReason: null, holdId: held.value.holdId };
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
      gaps: uncoveredGaps(coverage, durationSeconds),
    };
  }

  @Authorize({ kind: "campaign_view", action: "earn" })
  @NotValueMoving(
    "Records watched seconds. Moves no value: a replayed span merges into coverage already held, and completion is decided separately by reading that coverage.",
  )
  @RateLimit({ routeId: "watch.progress", identity: { max: 120, windowSeconds: 60 } })
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

    const { durationSeconds } = await this.loadOwnSession(request, sessionId);
    const now = new Date();
    const outcome = await this.sessions.recordProgress(
      sessionId,
      { fromSeconds: parsed.data.fromSeconds, toSeconds: parsed.data.toSeconds },
      durationSeconds,
      now,
    );

    switch (outcome.kind) {
      case "missing":
        throw new NotFoundException("No such watch session.");
      case "not_active":
        throw new ForbiddenException(`This session is ${outcome.state}.`);
      case "refused":
        throw new BadRequestException(describeRefusal(outcome.reason));
      case "accepted":
        return {
          accepted: true,
          coveredSeconds: coveredSeconds(outcome.coverage),
          fraction: coverageFraction(outcome.coverage, durationSeconds),
        };
    }
  }

  @Authorize({ kind: "campaign_view", action: "watch_rewarded" })
  @Idempotent({ retentionMs: SESSION_START_RETENTION_MS })
  @Post(":sessionId/complete")
  async complete(@Req() request: FastifyRequest, @Param("sessionId") sessionId: string) {
    const { session, durationSeconds } = await this.loadOwnSession(request, sessionId);
    const coverage = await this.sessions.coverageFor(session.id);

    const expectedQuestions = checkpointSchedule({
      sessionId: session.id,
      durationSeconds,
      count: questionsAskedFor(durationSeconds),
      secret: this.checkpointSecret,
    }).length;

    const verdict = judgeCompletion({
      session,
      coverage,
      durationSeconds,
      questionsAnswered: session.questionsAsked >= expectedQuestions,
      campaignIsLive: await this.campaigns.isLive(session.campaignId),
    });
    if (verdict !== "earned") {
      throw new ForbiddenException(describeCompletionRefusal(verdict));
    }

    const now = new Date();
    const matched = await this.sessions.markCompleted(session.id, now);
    if (!matched) {
      // Two concurrent completions raced this session; the OTHER one won.
      // Never a second grant from here.
      throw new ConflictException({
        code: "already_completing",
        message: "This session is already being completed by another request.",
      });
    }

    if (session.nonEarning) {
      return {
        completed: true,
        granted: false,
        reason: session.nonEarningReason,
        pendingPoints: 0,
      };
    }

    const terms = await this.campaigns.termsVersionDetails(
      session.campaignId,
      session.termsVersion,
    );
    if (terms === null) {
      // Should be structurally impossible (the composite FK guarantees the
      // row exists), but a reward must never be computed from a guess.
      throw new ForbiddenException("This session's terms version no longer exists.");
    }
    const profile = await this.profiles.findByUserId(session.userId);
    if (profile === null) {
      throw new ForbiddenException("No account profile found for this session.");
    }

    const points = pointsForCompletion(
      {
        rewardPoints: terms.rewardPoints,
        accuracyBonusPoints: terms.accuracyBonusPoints,
        scoringRule: terms.scoringRule,
      },
      session.questionsAsked,
      session.questionsCorrect,
    );
    const attestation = signRewardAttestation(this.attestationSecret, {
      sessionId: session.id,
      userId: session.userId,
      campaignId: session.campaignId,
      termsVersion: session.termsVersion,
      completedAt: now,
      asked: session.questionsAsked,
      correct: session.questionsCorrect,
    });

    const granted = await this.ledger.grantReward({
      campaignId: session.campaignId,
      userId: session.userId,
      region: profile.region,
      points: toPoints(points),
      trustTier: clampTrustTier(profile.trustTier),
      idempotencyKey: `watch-grant:${session.id}`,
      ...(session.holdId === null ? {} : { holdId: session.holdId }),
      attestation,
    });

    if (granted.isErr()) {
      // The coverage transition already committed — a completed, non-void
      // session that simply never got paid, with the reason recorded for
      // whoever investigates. Rolling the state back would let a second
      // `complete` re-attempt `judgeCompletion` against a session already
      // marked terminal, which is a bigger correctness risk than a stuck
      // grant is.
      return {
        completed: true,
        granted: false,
        reason: describeLedgerRefusal(granted.error),
        pendingPoints: 0,
      };
    }

    await this.sessions.markGranted(session.id);
    const deliveryCoverageVerdict = await this.delivery.deliveryCoverage(session.id);

    return {
      completed: true,
      granted: true,
      pendingPoints: granted.value.points,
      unlockAt: granted.value.unlockAt,
      deliveryCoverage: deliveryCoverageVerdict,
    };
  }

  /**
   * Loads a session that belongs to the caller, with the duration from the
   * FROZEN terms version it entered under (EW-20) — never the campaign's
   * current config, which an advertiser may have edited since.
   */
  private async loadOwnSession(
    request: FastifyRequest,
    sessionId: string,
  ): Promise<{ session: WatchSession; durationSeconds: number }> {
    const session = await this.sessions.findById(sessionId);
    if (session === null || session.userId !== (await this.principals.resolve(request)).id) {
      throw new NotFoundException("No such watch session.");
    }

    const campaign = await this.campaigns.findVisibleById(session.campaignId);
    if (campaign === null) {
      throw new NotFoundException("The campaign for this session is no longer available.");
    }
    const terms = await this.campaigns.termsVersionDetails(
      session.campaignId,
      session.termsVersion,
    );
    if (terms === null) {
      throw new NotFoundException("This session's terms version no longer exists.");
    }
    return { session, durationSeconds: terms.durationSeconds };
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function clampTrustTier(trustTier: number): 0 | 1 | 2 | 3 {
  if (trustTier >= 3) return 3;
  if (trustTier <= 0) return 0;
  return trustTier === 1 ? 1 : 2;
}

/** A short, honest, viewer-facing reason. Never the raw ledger code. */
function describeLedgerRefusal(error: LedgerError): string {
  switch (error.code) {
    case "allocation_exhausted":
    case "campaign_cap_reached":
      return "This campaign has run out of funding right now.";
    case "kill_switch":
      return "Rewards are paused right now.";
    case "region_mismatch":
    case "audience_blocked":
    case "currency_mismatch":
      return "This campaign is not available to your account.";
    case "velocity_capped":
      return "You have reached today's earning limit.";
    case "solvency_blocked":
      return "Rewards are temporarily unavailable.";
    default:
      return "This campaign could not be funded right now.";
  }
}
