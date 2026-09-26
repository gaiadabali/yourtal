import {
  BadRequestException,
  Body,
  ConflictException,
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
import { toPresentedQuestion } from "@yourtal/contracts/question/presented-question";
import { questionsAskedFor } from "@yourtal/contracts/question/question-bank";
import {
  CHECKPOINT_ANSWER_TIMER_MS,
  CHECKPOINT_TOKEN_TTL_MS,
} from "@yourtal/contracts/watch/checkpoint-token";
import { uncoveredGaps } from "@yourtal/contracts/watch/coverage";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../../shared/authz/principal-resolver";
import { CAMPAIGN_REPOSITORY } from "../../campaign/persistence/campaign.repository";
import type { CampaignRepository } from "../../campaign/persistence/campaign.repository";
import { WATCH_SESSION_REPOSITORY } from "../persistence/drizzle-watch-session.repository";
import type { WatchSessionRepository } from "../persistence/drizzle-watch-session.repository";
import { QUESTION_BANK_REPOSITORY } from "../question/question-bank.repository";
import type { QuestionBankRepository } from "../question/question-bank.repository";
import { QUESTION_ANSWER_REPOSITORY } from "../question/question-answer.repository";
import type { QuestionAnswerRepository } from "../question/question-answer.repository";
import { CheckpointService } from "./checkpoint.service";

/**
 * Questions during the video, served and scored on the server (F10, 5.2).
 *
 * A separate controller beside `WatchController`, same reasoning as before:
 * a second surface rather than editing the first, so neither ticket's
 * criteria move underneath the other while both are in flight.
 *
 * ## Why issuing is a `POST`, not the plain `GET` TASKS.md 5.2.c describes
 *
 * Issuing a token consumes the one live slot for this checkpoint
 * (`CheckpointIssueRepository`) — that is what "single-use" means for
 * issuance, not just for the answer. A `GET` a proxy or a browser
 * pre-fetches without the caller asking is exactly the request this must
 * not silently repeat for free, so it stays a `POST`, `@NotValueMoving`
 * (repeating it while the prior issuance is still live is a no-op by
 * construction — `CheckpointService.issue` returns the SAME token — so it
 * needs no `Idempotency-Key` of its own).
 */
@Controller("api/watch/sessions")
export class CheckpointController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    private readonly checkpoints: CheckpointService,
    @Inject(WATCH_SESSION_REPOSITORY) private readonly sessions: WatchSessionRepository,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(QUESTION_BANK_REPOSITORY) private readonly bank: QuestionBankRepository,
    @Inject(QUESTION_ANSWER_REPOSITORY) private readonly answers: QuestionAnswerRepository,
  ) {}

  @Authorize({ kind: "campaign_view", action: "earn" })
  @NotValueMoving(
    "Reissuing while the prior issuance is still live returns the identical token — CheckpointIssueRepository makes issuance itself idempotent, so no separate key is needed.",
  )
  @Post(":sessionId/checkpoints/:checkpointIndex")
  async present(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Param("checkpointIndex") rawIndex: string,
  ) {
    const checkpointIndex = Number(rawIndex);
    if (!Number.isInteger(checkpointIndex) || checkpointIndex < 0) {
      throw new BadRequestException("A checkpoint index is a whole number from zero.");
    }

    const { session, durationSeconds, campaignId } = await this.loadActiveOwnSession(
      request,
      sessionId,
    );
    const schedule = this.checkpoints.schedule(
      sessionId,
      durationSeconds,
      // 5.2.a: ONE count everywhere. `campaign.questionCount` is a
      // per-campaign authoring field; the schedule always uses F10's
      // formula over the session's own frozen duration (EW-20).
      questionsAskedFor(durationSeconds),
    );
    if (checkpointIndex >= schedule.length) {
      throw new NotFoundException("No such checkpoint in this session.");
    }

    // Sequential only. A client asking for index 3 before answering 0-2
    // would learn every future checkpoint's existence (and, combined with
    // the coverage gate below, roughly its time) ahead of reaching it.
    if (checkpointIndex !== session.questionsAsked) {
      throw new ForbiddenException(
        checkpointIndex < session.questionsAsked
          ? "This checkpoint has already been answered."
          : "Answer the current checkpoint before asking for the next one.",
      );
    }

    const atSecond = schedule[checkpointIndex];
    if (atSecond === undefined) {
      throw new NotFoundException("No such checkpoint in this session.");
    }
    const coverage = await this.sessions.coverageFor(sessionId);
    // A couple of seconds' slack for player/report timing jitter — the same
    // reasoning `TOLERANCE_SECONDS` gives the progress check, sized much
    // smaller here since this only gates WHEN a question may appear, not
    // how much reward it is worth.
    const reached = uncoveredGaps(coverage, Math.max(0, atSecond - 2)).length === 0;
    if (!reached) {
      throw new ConflictException({
        code: "checkpoint_not_reached",
        message: "Keep watching — this checkpoint unlocks once you reach it.",
      });
    }

    const askableBank = await this.bank.askableBank(campaignId);
    const question = this.checkpoints.pickQuestion(
      askableBank,
      sessionId,
      schedule,
      checkpointIndex,
    );
    if (question === null) {
      // The bank cannot cover this checkpoint. A campaign passes 7.3's
      // approval gate only with `requiredBankSize` questions, so this is a
      // seeding gap rather than an expected runtime outcome — refused
      // rather than silently skipped, so it is visible.
      throw new NotFoundException("No question is available for this checkpoint.");
    }

    const issued = await this.checkpoints.issue(sessionId, checkpointIndex, Date.now());
    return {
      question: toPresentedQuestion(question),
      token: issued.token,
      expiresAt: new Date(issued.expiresAtMs).toISOString(),
      atSecond,
      answerTimerMs: CHECKPOINT_ANSWER_TIMER_MS,
    };
  }

  @Authorize({ kind: "campaign_view", action: "earn" })
  @NotValueMoving(
    "Scores and records the answer, once, under the checkpoint token's own single-use guarantee (checkpoint_answered_once_per_session) — a retry with the SAME token is refused by the nonce/answer tables, not replayed.",
  )
  @Post(":sessionId/checkpoints/:checkpointIndex/answer")
  async answer(
    @Req() request: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Param("checkpointIndex") rawIndex: string,
    @Body() body: unknown,
  ) {
    const checkpointIndex = Number(rawIndex);
    if (!Number.isInteger(checkpointIndex) || checkpointIndex < 0) {
      throw new BadRequestException("A checkpoint index is a whole number from zero.");
    }
    const parsed = answerBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("An answer needs its checkpoint token.");
    }

    const { durationSeconds, campaignId } = await this.loadActiveOwnSession(request, sessionId);
    const nowMs = Date.now();
    const redeemed = await this.checkpoints.redeem({
      token: parsed.data.token,
      sessionId,
      checkpointIndex,
      nowMs,
    });
    if (!redeemed.redeemed) {
      throw new ForbiddenException(
        "That checkpoint token could not be redeemed — it may be expired, already used, or for a different checkpoint.",
      );
    }

    const schedule = this.checkpoints.schedule(
      sessionId,
      durationSeconds,
      questionsAskedFor(durationSeconds),
    );
    const askableBank = await this.bank.askableBank(campaignId);
    const question = this.checkpoints.pickQuestion(
      askableBank,
      sessionId,
      schedule,
      checkpointIndex,
    );
    if (question === null) {
      throw new NotFoundException("No question is available for this checkpoint.");
    }

    const issuedAtMs = redeemed.expiresAtMs - CHECKPOINT_TOKEN_TTL_MS;
    const latencyMs = nowMs - issuedAtMs;
    const { wasCorrect } = await this.answers.recordAnswer({
      sessionId,
      question,
      selectedOptionId: parsed.data.selectedOptionId ?? null,
      answeredBool: parsed.data.answeredBool ?? null,
      latencyMs,
      // "Timeout = answered wrong, never voids" — the SERVER's own clock,
      // never anything the client reports.
      timedOut: latencyMs > CHECKPOINT_ANSWER_TIMER_MS,
    });

    return { answered: true, wasCorrect };
  }

  private async loadActiveOwnSession(request: FastifyRequest, sessionId: string) {
    const session = await this.sessions.findById(sessionId);
    // Someone else's session is a 404, not a 403 — the same enumeration
    // discipline `WatchController.loadOwnSession` applies.
    if (session === null || session.userId !== (await this.principals.resolve(request)).id) {
      throw new NotFoundException("No such watch session.");
    }
    if (session.state !== "active") {
      throw new ForbiddenException("This watch session is no longer active.");
    }
    const campaign = await this.campaigns.findVisibleById(session.campaignId);
    if (campaign === null) {
      throw new NotFoundException("The campaign for this session is no longer available.");
    }
    // EW-20: the FROZEN terms this session entered under, never the
    // campaign's current (possibly since-edited) duration.
    const terms = await this.campaigns.termsVersionDetails(
      session.campaignId,
      session.termsVersion,
    );
    if (terms === null) {
      throw new NotFoundException("This session's terms version no longer exists.");
    }
    return { session, durationSeconds: terms.durationSeconds, campaignId: session.campaignId };
  }
}

const answerBodySchema = z.object({
  token: z.string().min(1),
  selectedOptionId: z.uuid().optional(),
  answeredBool: z.boolean().optional(),
});
