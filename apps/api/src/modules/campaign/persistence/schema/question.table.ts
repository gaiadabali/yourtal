import { bigint, boolean, integer, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campaignPgSchema } from "./campaign-schema";

/**
 * `campaign.question` / `question_answer_key` / `question_option`, as
 * `20260920000017_question_bank.sql` defines them (YT-0102). No Drizzle
 * mirror existed before TASKS.md 7.3 — the tables were written by hand in
 * that migration and never given a schema file, which is exactly why
 * nothing ever wrote to them (docs/audit/2026-09-25/business-merchant.md).
 *
 * The answer key stays a SEPARATE table (see the migration's own header):
 * `questionAnswerKeys` below is never joined into an ordinary question read.
 */
export const questions = campaignPgSchema.table("question", {
  id: uuid("id").primaryKey(),
  campaignId: uuid("campaign_id").notNull(),
  type: text("type").notNull(),
  prompt: text("prompt").notNull(),
  timerSeconds: integer("timer_seconds").notNull(),
  status: text("status").notNull().default("draft"),
  piiScreen: text("pii_screen"),
  retiredReason: text("retired_reason"),
  timesAsked: bigint("times_asked", { mode: "number" }).notNull().default(0),
  timesCorrect: bigint("times_correct", { mode: "number" }).notNull().default(0),
  /** F10 (1.1.f): the earliest video second this question may be asked at. */
  answerableAfterSeconds: integer("answerable_after_seconds").notNull().default(0),
});

export const questionAnswerKeys = campaignPgSchema.table("question_answer_key", {
  questionId: uuid("question_id").primaryKey(),
  correctOptionId: uuid("correct_option_id"),
  correctAnswer: boolean("correct_answer"),
});

export const questionOptions = campaignPgSchema.table(
  "question_option",
  {
    id: uuid("id").primaryKey(),
    questionId: uuid("question_id").notNull(),
    label: text("label").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    uniqueIndex("question_option_question_id_ordinal_key").on(table.questionId, table.ordinal),
  ],
);
