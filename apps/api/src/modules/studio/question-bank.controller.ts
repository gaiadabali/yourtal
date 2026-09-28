import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { questionSchema } from "@yourtal/contracts/question";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { CAMPAIGN_DRAFT_REPOSITORY } from "./persistence/campaign-draft.repository";
import type { CampaignDraftRepository } from "./persistence/campaign-draft.repository";
import { QUESTION_BANK_REPOSITORY } from "./persistence/question-bank.repository";
import type { QuestionBankRepository } from "./persistence/question-bank.repository";
import { createQuestion } from "./use-cases/create-question.use-case";
import { listQuestions } from "./use-cases/list-questions.use-case";
import { updateQuestion } from "./use-cases/update-question.use-case";
import { retireQuestion } from "./use-cases/retire-question.use-case";
import { mapStudioErrorToHttpException } from "./to-http-exception";

/** TASKS.md 7.3.b — the question bank moves server-side, PII guard and all. */
@Controller("api/:tenantId/studio/campaigns/:campaignId/questions")
export class QuestionBankController {
  constructor(
    @Inject(CAMPAIGN_DRAFT_REPOSITORY) private readonly drafts: CampaignDraftRepository,
    @Inject(QUESTION_BANK_REPOSITORY) private readonly bank: QuestionBankRepository,
  ) {}

  @Authorize({
    kind: "campaign",
    action: "edit_questions",
    idFrom: (request) => campaignIdOf(request),
  })
  @Get()
  async list(@Param("campaignId") campaignId: string) {
    const result = await listQuestions(this.bank, campaignId);
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }

  // No class-based Zod DTO here: `questionSchema` is a discriminated union
  // whose members include a `.refine()`-wrapped branch
  // (multipleChoiceQuestionSchema), and TypeScript refuses `class X extends
  // createZodDto(unionSchema) {}` for that shape ("base constructor return
  // type is not an object type"). Validated directly instead — still the
  // one real gate, just called imperatively rather than through the global
  // pipe.
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Authorize({
    kind: "campaign",
    action: "edit_questions",
    idFrom: (request) => campaignIdOf(request),
  })
  @Post()
  async create(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = questionSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ code: "validation_failed", message: parsed.error.message });
    }
    // `id`/`campaignId` on the body are required by `questionSchema` but
    // ignored -- the server assigns a real id and the route's own
    // `:campaignId` is authoritative.
    const { id: _id, campaignId: _campaignId, ...question } = parsed.data;
    const result = await createQuestion(
      { drafts: this.drafts, bank: this.bank },
      tenantId,
      campaignId,
      question,
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }

  // Same "no class-based Zod DTO" reasoning as `create` above --
  // `questionSchema` is a discriminated union with a `.refine()`-wrapped
  // branch and cannot become a `createZodDto` class.
  @NotValueMoving(
    "A patch that repeats the same fields ends at the same row -- nothing to duplicate.",
  )
  @Authorize({
    kind: "campaign",
    action: "edit_questions",
    idFrom: (request) => campaignIdOf(request),
  })
  @Patch(":questionId")
  async update(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
    @Param("questionId") questionId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = questionSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ code: "validation_failed", message: parsed.error.message });
    }
    // Same as `create`: `id`/`campaignId` on the body are required by the
    // schema's shape but ignored -- the route's own params are authoritative.
    const { id: _id, campaignId: _campaignId, ...question } = parsed.data;
    const result = await updateQuestion(
      { drafts: this.drafts, bank: this.bank },
      tenantId,
      campaignId,
      questionId,
      question,
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving(
    "Soft-retires (updateStatus, an idempotent write): retiring an already-retired " +
      "question repeats the same end state, nothing duplicates.",
  )
  @Authorize({
    kind: "campaign",
    action: "edit_questions",
    idFrom: (request) => campaignIdOf(request),
  })
  @Delete(":questionId")
  async retire(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
    @Param("questionId") questionId: string,
  ) {
    const result = await retireQuestion(
      { drafts: this.drafts, bank: this.bank },
      tenantId,
      campaignId,
      questionId,
    );
    if (result.isErr()) throw mapStudioErrorToHttpException(result.error);
    return result.value;
  }
}

function campaignIdOf(request: FastifyRequest): string {
  const params: unknown = request.params;
  if (typeof params !== "object" || params === null) return "";
  const value: unknown = Reflect.get(params, "campaignId");
  return typeof value === "string" ? value : "";
}
