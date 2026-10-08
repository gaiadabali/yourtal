import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
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

import { isQuietHours } from "@yourtal/contracts/me/quiet-hours";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
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
import { mintManifestUrl } from "./media/mint-manifest-url";
import { MANIFEST_SIGNING_SECRET } from "./media/manifest-signing-secret";
import { DELIVERY_COVERAGE_READER } from "./delivery-coverage";
import { describeLedgerRefusal } from "./ledger-refusal";
import { WATCH_COMPLETION_HOOK } from "./watch-completion-hook";
import type { WatchCompletionHook } from "./watch-completion-hook";
import type { DeliveryCoverageReader } from "./delivery-coverage";

const startBody = z.object({ campaignId: z.uuid() });
const progressBody = z.object({
  fromSeconds: z.number().min(0),
  toSeconds: z.number().min(0),
  reportedAt: z.iso.datetime(),
});

/** A day. A watch session is resumable while its campaign runs; a retry is not. */
const SESSION_START_RETENTION_MS = 24 * 60 * 60 * 1_000;

const CONTINUE_WATCHING_LIMIT = 20;

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
  private readonly logger = new Logger("WatchController");

  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(WATCH_SESSION_REPOSITORY) private readonly sessions: WatchSessionRepository,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
    @Inject(REWARD_ATTESTATION_SECRET) private readonly attestationSecret: string,
    @Inject(CHECKPOINT_SECRET) private readonly checkpointSecret: string,
    @Inject(MANIFEST_SIGNING_SECRET) private readonly manifestSigningSecret: string,
    @Inject(DELIVERY_COVERAGE_READER) private readonly delivery: DeliveryCoverageReader,
    @Inject(WATCH_COMPLETION_HOOK) private readonly completionHook: WatchCompletionHook,
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

    // 12.2.b: F12's teen quiet hours (21:00-07:00 in the PROFILE's own
    // timezone, never the region's) refuse a new reward session outright --
    // checked before anything else in this handler, so a teen never even
    // reaches the campaign/terms lookups below during quiet hours. Resolved
    // here (not via `AsyncPrincipalResolver`) because this controller
    // already reads the profile row directly a few lines down for the same
    // reason `require-region.ts` gives for the rest of this module: read
    // the profile, not a principal attribute cached at session time.
    const userId = (await this.principals.resolve(request)).id;
    const profile = await this.profiles.findByUserId(userId);
    if (profile !== null) {
      const ageBand = ageBandFrom(ageYearsFrom(profile.dateOfBirth, new Date()));
      if (ageBand === "teen" && isQuietHours(new Date(), profile.timezone)) {
        throw new ForbiddenException({
          code: "teen_quiet_hours",
          message:
            "Reward sessions pause during quiet hours (21:00-07:00). Try again in the morning.",
        });
      }
    }

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
      // 5.6.a: a per-session manifest URL, signed with the same scheme
      // `/api/internal/hls-auth` verifies for nginx.
      manifestUrl: mintManifestUrl({
        secret: this.manifestSigningSecret,
        hlsUrl: campaign.hlsUrl,
        sessionId: session.id,
        durationSeconds: terms.durationSeconds,
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

  @Authorize({ kind: "me", action: "view_continue_watching" })
  @NotValueMoving("A read of the caller's own unfinished sessions.")
  @Get()
  async listActive(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    const active = await this.sessions.listActiveForUser(userId, CONTINUE_WATCHING_LIMIT);
    const rows = await Promise.all(
      active.map(async (session) => {
        // A campaign that left the catalogue is not worth resuming.
        const campaign = await this.campaigns.findVisibleById(session.campaignId);
        if (campaign === null) return null;
        const coverage = await this.sessions.coverageFor(session.id);
        return {
          sessionId: session.id,
          campaignId: session.campaignId,
          lastProgressAt: session.lastProgressAt,
          coveredSeconds: coveredSeconds(coverage),
          durationSeconds: campaign.durationSeconds,
        };
      }),
    );
    return { sessions: rows.filter((row) => row !== null) };
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

    const { session, durationSeconds } = await this.loadOwnSession(request, sessionId);
    // EW-19: a paused or ended campaign stays resumable/readable so nobody
    // mid-watch is stranded (loadOwnSession still finds it), but it must
    // not accept new progress once it can no longer pay out.
    if (!(await this.campaigns.isLive(session.campaignId))) {
      throw new ForbiddenException("This campaign is no longer running.");
    }
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
      // 11.5.i: the real per-question timing signal, accumulated by
      // question-answer.repository.ts across this session's answers —
      // never a placeholder `false`.
      timingSuspicious: session.timingSuspicious,
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
    if (deliveryCoverageVerdict === "gap_detected") {
      // 11.5.f: never gates or delays the grant above (delivery-coverage.ts's
      // own header) — this is evidence recorded AFTER the fact, for whoever
      // reviews fraud later. Usually reads "unknown" at this point in
      // practice (the log ingests on its own 5-minute cycle, 10.4.c), so a
      // real gap surfacing here is itself notable.
      this.logger.warn(`delivery coverage gap — session=${session.id}, flagged for review`);
      await this.sessions.flagDeliveryGap(session.id, now);
    }

    // 5.5.d's hook: fired only for a genuinely earning, granted completion
    // — never for a non-earning one (see watch-completion-hook.ts's own
    // header for why, and for how to bind a real listener).
    await this.completionHook.onWatchCompleted({
      userId: session.userId,
      campaignId: session.campaignId,
      sessionId: session.id,
      completedAt: now,
      region: profile.region,
    });

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

function clampTrustTier(trustTier: number): 0 | 1 | 2 | 3 {
  if (trustTier >= 3) return 3;
  if (trustTier <= 0) return 0;
  return trustTier === 1 ? 1 : 2;
}
