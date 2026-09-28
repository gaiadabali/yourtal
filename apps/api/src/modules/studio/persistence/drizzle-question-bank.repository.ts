import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Question } from "@yourtal/contracts/question";
import type { PiiScreenVerdict, QuestionStatus } from "@yourtal/contracts/question/bank";
import {
  questionAnswerKeys,
  questionOptions,
  questions,
} from "../../campaign/persistence/schema/question.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type {
  BankQuestionRecord,
  NewQuestion,
  QuestionBankRepository,
} from "./question-bank.repository";

/**
 * Verified against a live Postgres. First writer these tables have ever
 * had (docs/audit/2026-09-25/business-merchant.md: "DB tables exist,
 * seeded only, no API").
 */
export class DrizzleQuestionBankRepository implements QuestionBankRepository {
  constructor(private readonly db: AppDb) {}

  async create(
    campaignId: string,
    question: NewQuestion,
    piiScreen: PiiScreenVerdict,
  ): Promise<BankQuestionRecord> {
    const id = randomUUID();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(questions)
        .values({
          id,
          campaignId,
          type: question.type,
          prompt: question.prompt,
          timerSeconds: question.timerSeconds,
          answerableAfterSeconds: question.answerableAfterSeconds,
          piiScreen,
        })
        .returning();
      if (row === undefined) throw new Error("insert into campaign.question returned no row");

      if (question.type === "multiple_choice") {
        const optionRows = await tx
          .insert(questionOptions)
          .values(
            question.options.map((option, index) => ({
              id: randomUUID(),
              questionId: id,
              label: option.label,
              ordinal: index,
            })),
          )
          .returning();
        const correctRow = optionRows.find(
          (_option, index) => question.options[index]?.id === question.correctOptionId,
        );
        // The client-supplied option id is authoring-local (the form's own
        // draft state) — what is actually stored is this row's real id, so
        // the answer key always points at a row that exists.
        const correctOptionId = correctRow?.id ?? optionRows[0]?.id;
        if (correctOptionId === undefined) {
          throw new Error("multiple_choice question has no options to key against");
        }
        await tx.insert(questionAnswerKeys).values({ questionId: id, correctOptionId });
        return assemble(row, piiScreen, {
          ...question,
          id,
          campaignId,
          options: optionRows.map((option) => ({ id: option.id, label: option.label })),
          correctOptionId,
        });
      }

      if (question.type === "true_false") {
        await tx
          .insert(questionAnswerKeys)
          .values({ questionId: id, correctAnswer: question.correctAnswer });
        return assemble(row, piiScreen, { ...question, id, campaignId });
      }

      if (question.type === "ranked") {
        const optionRows = await tx
          .insert(questionOptions)
          .values(
            question.items.map((item, index) => ({
              id: randomUUID(),
              questionId: id,
              label: item.label,
              ordinal: index,
            })),
          )
          .returning();
        // No answer key row — a ranking question has no single correct answer to score against.
        return assemble(row, piiScreen, {
          ...question,
          id,
          campaignId,
          items: optionRows.map((option) => ({ id: option.id, label: option.label })),
        });
      }

      // likert / short_text: no options, no answer key — opinion/free-text, never scored.
      return assemble(row, piiScreen, { ...question, id, campaignId });
    });
  }

  async listByCampaign(campaignId: string): Promise<readonly BankQuestionRecord[]> {
    const rows = await this.db
      .select()
      .from(questions)
      .where(eq(questions.campaignId, campaignId))
      .orderBy(asc(questions.id));
    return Promise.all(rows.map((row) => this.assembleFromRow(row)));
  }

  async findById(questionId: string): Promise<BankQuestionRecord | null> {
    const [row] = await this.db
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);
    if (row === undefined) return null;
    return this.assembleFromRow(row);
  }

  async updateStatus(
    questionId: string,
    status: QuestionStatus,
    retiredReason: string | null,
  ): Promise<BankQuestionRecord | null> {
    const [row] = await this.db
      .update(questions)
      .set({ status, retiredReason })
      .where(eq(questions.id, questionId))
      .returning();
    if (row === undefined) return null;
    return this.assembleFromRow(row);
  }

  async update(
    questionId: string,
    question: NewQuestion,
    piiScreen: PiiScreenVerdict,
  ): Promise<BankQuestionRecord | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(questions)
        .set({
          prompt: question.prompt,
          timerSeconds: question.timerSeconds,
          answerableAfterSeconds: question.answerableAfterSeconds,
          piiScreen,
          status: "draft",
          retiredReason: null,
        })
        .where(eq(questions.id, questionId))
        .returning();
      if (row === undefined) return null;

      // `question_option` may be freely replaced (whole-list, not a
      // per-item PATCH of one option -- the same rule
      // `UpdateCampaignDraftInput`'s chapters/declaredInterests use).
      // `question_answer_key` may NOT: `yourtal_app` holds no DELETE on it
      // at all (20260920000017's own grant comment -- "a question whose
      // key vanished would silently score every answer as wrong, and the
      // viewer who lost a reward would have no evidence anything had
      // changed"), so an edit UPDATEs the existing key row in place rather
      // than dropping and re-inserting it. `type` cannot change here (the
      // use-case refuses that before this is ever called), so the row this
      // UPDATE targets is guaranteed to already exist in the right shape
      // from whichever `create()` call first wrote it.
      await tx.delete(questionOptions).where(eq(questionOptions.questionId, questionId));

      if (question.type === "multiple_choice") {
        const optionRows = await tx
          .insert(questionOptions)
          .values(
            question.options.map((option, index) => ({
              id: randomUUID(),
              questionId,
              label: option.label,
              ordinal: index,
            })),
          )
          .returning();
        const correctRow = optionRows.find(
          (_option, index) => question.options[index]?.id === question.correctOptionId,
        );
        const correctOptionId = correctRow?.id ?? optionRows[0]?.id;
        if (correctOptionId === undefined) {
          throw new Error("multiple_choice question has no options to key against");
        }
        await tx
          .update(questionAnswerKeys)
          .set({ correctOptionId })
          .where(eq(questionAnswerKeys.questionId, questionId));
        return assemble(row, piiScreen, {
          ...question,
          id: questionId,
          campaignId: row.campaignId,
          options: optionRows.map((option) => ({ id: option.id, label: option.label })),
          correctOptionId,
        });
      }

      if (question.type === "true_false") {
        await tx
          .update(questionAnswerKeys)
          .set({ correctAnswer: question.correctAnswer })
          .where(eq(questionAnswerKeys.questionId, questionId));
        return assemble(row, piiScreen, {
          ...question,
          id: questionId,
          campaignId: row.campaignId,
        });
      }

      if (question.type === "ranked") {
        const optionRows = await tx
          .insert(questionOptions)
          .values(
            question.items.map((item, index) => ({
              id: randomUUID(),
              questionId,
              label: item.label,
              ordinal: index,
            })),
          )
          .returning();
        return assemble(row, piiScreen, {
          ...question,
          id: questionId,
          campaignId: row.campaignId,
          items: optionRows.map((option) => ({ id: option.id, label: option.label })),
        });
      }

      // likert / short_text: same gap create() already has -- these two
      // types' own per-type fields are not persisted columns today
      // (assembleFromRow's own comment), so there is nothing further to
      // write; the base-field update above already applied.
      return assemble(row, piiScreen, { ...question, id: questionId, campaignId: row.campaignId });
    });
  }

  private async assembleFromRow(row: typeof questions.$inferSelect): Promise<BankQuestionRecord> {
    const type = row.type as Question["type"];
    const base = {
      id: row.id,
      campaignId: row.campaignId,
      prompt: row.prompt,
      timerSeconds: row.timerSeconds,
      answerableAfterSeconds: row.answerableAfterSeconds,
    };

    if (type === "multiple_choice") {
      const [options, [key]] = await Promise.all([
        this.db
          .select()
          .from(questionOptions)
          .where(eq(questionOptions.questionId, row.id))
          .orderBy(asc(questionOptions.ordinal)),
        this.db
          .select()
          .from(questionAnswerKeys)
          .where(eq(questionAnswerKeys.questionId, row.id))
          .limit(1),
      ]);
      return assemble(row, row.piiScreen as BankQuestionRecord["piiScreen"], {
        ...base,
        type,
        options: options.map((option) => ({ id: option.id, label: option.label })),
        correctOptionId: key?.correctOptionId ?? "",
      });
    }

    if (type === "true_false") {
      const [key] = await this.db
        .select()
        .from(questionAnswerKeys)
        .where(eq(questionAnswerKeys.questionId, row.id))
        .limit(1);
      return assemble(row, row.piiScreen as BankQuestionRecord["piiScreen"], {
        ...base,
        type,
        correctAnswer: key?.correctAnswer ?? false,
      });
    }

    if (type === "ranked") {
      const items = await this.db
        .select()
        .from(questionOptions)
        .where(eq(questionOptions.questionId, row.id))
        .orderBy(asc(questionOptions.ordinal));
      return assemble(row, row.piiScreen as BankQuestionRecord["piiScreen"], {
        ...base,
        type,
        items: items.map((item) => ({ id: item.id, label: item.label })),
      });
    }

    if (type === "likert") {
      // scaleMin/Max/labels are not persisted columns today (Studio's first
      // pass supports likert authoring only as an unscored opinion prompt) —
      // a tracked gap, not silently wrong: the reader fills defaults rather
      // than fabricate authored values it never stored.
      return assemble(row, row.piiScreen as BankQuestionRecord["piiScreen"], {
        ...base,
        type,
        scaleMin: 1,
        scaleMax: 5,
        scaleLowLabel: "Low",
        scaleHighLabel: "High",
      });
    }

    return assemble(row, row.piiScreen as BankQuestionRecord["piiScreen"], {
      ...base,
      type: "short_text",
      maxLength: 500,
    });
  }
}

function assemble(
  row: typeof questions.$inferSelect,
  piiScreen: BankQuestionRecord["piiScreen"],
  question: Question,
): BankQuestionRecord {
  return {
    question,
    status: row.status as QuestionStatus,
    piiScreen,
    timesAsked: row.timesAsked,
    timesCorrect: row.timesCorrect,
    retiredReason: row.retiredReason,
  };
}
