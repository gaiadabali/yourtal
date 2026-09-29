import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Applied by `packages/db/migrations/20260920000013_watch_session.sql`, and
 * widened by `20260926130000_watch_session_parking.sql` (5.1.b: `parked`,
 * non-earning bookkeeping, the question counters completion reads).
 */
export const watchPgSchema = pgSchema("watch");

export const watchSessions = watchPgSchema.table("session", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  termsVersion: integer("terms_version").notNull(),
  state: text("state").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastProgressAt: timestamp("last_progress_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  nonEarning: boolean("non_earning").notNull(),
  nonEarningReason: text("non_earning_reason"),
  holdId: text("hold_id"),
  questionsAsked: integer("questions_asked").notNull(),
  questionsCorrect: integer("questions_correct").notNull(),
  granted: boolean("granted").notNull(),
  // 11.5.i (20260929090000): sticky verdict from question-response-signals,
  // accumulated across this session's answers by
  // `DrizzleQuestionAnswerRepository.recordAnswer` and read at completion
  // (`WatchController.complete`) to set the ledger grant's `TimingSuspicious`.
  timingSuspicious: boolean("timing_suspicious").notNull(),
  // Raw latencies (ms), one per answered question, for the jitter check
  // (`isMachineRegular`) — `campaign.question_response` cannot be re-SELECTed
  // (`yourtal_app` has INSERT only there), so this is this signal's own copy.
  answerLatenciesMs: jsonb("answer_latencies_ms").notNull().$type<number[]>(),
  // 11.5.f: set when the real DeliveryCoverageReader answers `gap_detected`
  // at completion. Never gates the grant — written after it already ran.
  deliveryGapFlaggedAt: timestamp("delivery_gap_flagged_at", { withTimezone: true }),
});

/**
 * Append-only. The app role has INSERT and SELECT and no UPDATE or DELETE —
 * this is the evidence a reward is paid against, and evidence that can be
 * edited after the fact is not evidence.
 */
export const watchCoverage = watchPgSchema.table("coverage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sessionId: uuid("session_id").notNull(),
  fromSecond: integer("from_second").notNull(),
  toSecond: integer("to_second").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
});
