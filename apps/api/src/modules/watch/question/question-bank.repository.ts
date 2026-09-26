import { sql } from "drizzle-orm";
import { questionSchema, type Question } from "@yourtal/contracts/question/question";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

export const QUESTION_BANK_REPOSITORY = Symbol("QUESTION_BANK_REPOSITORY");

/**
 * Reads a campaign's ASKABLE question bank. 5.2.
 *
 * Raw SQL rather than a Drizzle table for the same reason
 * `DrizzleCampaignRepository.rewardConfigFor` is: `campaign.question`,
 * `campaign.question_option` and `campaign.question_answer_key`
 * (20260920000017) are C's tables (7.1/7.3, studio) and this session must
 * not add a schema file under `campaign/persistence/schema/**`.
 *
 * Only `multiple_choice` and `true_false` rows are ever returned. That is
 * not a simplification this file invented: `question_answer_key`'s own
 * CHECK (`answer_key_exactly_one_shape`) means a `likert`, `ranked` or
 * `short_text` row could never satisfy the join below in the first place —
 * those types have no scored key in this schema yet. Filtering to `status =
 * 'approved' AND pii_screen = 'clear'` is `judgeBankForApproval`'s own gate,
 * enforced again here rather than trusted from authoring time, for the same
 * reason a viewer-facing read never trusts a campaign's current state
 * without re-checking it.
 */
export interface QuestionBankRepository {
  askableBank(campaignId: string): Promise<readonly Question[]>;
}

type Row = {
  id: string;
  campaign_id: string;
  type: string;
  prompt: string;
  timer_seconds: number;
  answerable_after_seconds: number;
  correct_option_id: string | null;
  correct_answer: boolean | null;
};

type OptionRow = { question_id: string; id: string; label: string };

export class DrizzleQuestionBankRepository implements QuestionBankRepository {
  constructor(private readonly db: AppDb) {}

  async askableBank(campaignId: string): Promise<readonly Question[]> {
    const questions = await this.db.execute<Row>(sql`
      SELECT q.id, q.campaign_id, q.type, q.prompt, q.timer_seconds,
             q.answerable_after_seconds,
             k.correct_option_id, k.correct_answer
        FROM campaign.question q
        JOIN campaign.question_answer_key k ON k.question_id = q.id
       WHERE q.campaign_id = ${campaignId}
         AND q.status = 'approved' AND q.pii_screen = 'clear'
         AND q.type IN ('multiple_choice', 'true_false')
    `);
    if (questions.rows.length === 0) return [];

    const options = await this.db.execute<OptionRow>(sql`
      SELECT o.question_id, o.id, o.label
        FROM campaign.question_option o
        JOIN campaign.question q ON q.id = o.question_id
       WHERE q.campaign_id = ${campaignId}
       ORDER BY o.ordinal
    `);
    const optionsByQuestion = new Map<string, OptionRow[]>();
    for (const option of options.rows) {
      const list = optionsByQuestion.get(option.question_id) ?? [];
      list.push(option);
      optionsByQuestion.set(option.question_id, list);
    }

    const bank: Question[] = [];
    for (const row of questions.rows) {
      const shared = {
        id: row.id,
        campaignId: row.campaign_id,
        prompt: row.prompt,
        timerSeconds: row.timer_seconds,
        answerableAfterSeconds: row.answerable_after_seconds,
      };
      const candidate =
        row.type === "multiple_choice" && row.correct_option_id !== null
          ? {
              ...shared,
              type: "multiple_choice" as const,
              options: (optionsByQuestion.get(row.id) ?? []).map((option) => ({
                id: option.id,
                label: option.label,
              })),
              correctOptionId: row.correct_option_id,
            }
          : row.type === "true_false" && row.correct_answer !== null
            ? { ...shared, type: "true_false" as const, correctAnswer: row.correct_answer }
            : null;

      // Parsed, not assumed. A malformed row (a type without a matching key
      // column, or a multiple_choice with fewer than two options) is
      // DROPPED rather than served broken — the same "unparseable is
      // absent, not a 500" rule `DrizzleCampaignRepository.assemble` follows
      // for campaigns.
      const parsed = candidate === null ? null : questionSchema.safeParse(candidate);
      if (parsed?.success === true) bank.push(parsed.data);
    }
    return bank;
  }
}
