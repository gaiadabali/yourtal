import type { Campaign } from "@yourtal/contracts/campaign";
import { toPoints } from "@yourtal/contracts/money";
import type {
  LikertQuestion,
  MultipleChoiceQuestion,
  RankedQuestion,
  ShortTextQuestion,
  TrueFalseQuestion,
} from "@yourtal/contracts/question";

/**
 * Hand-built fixtures, one per question type, shared across this feature's
 * tests. Built directly against the member types exported from
 * `@yourtal/contracts/question` (not re-derived or guessed), per this
 * ticket's instruction to treat that schema as the spec. UUID literals
 * follow the same v4-shaped convention `packages/contracts` uses in its
 * own tests (3rd group starts "4", 4th group starts "8") so they pass
 * `z.uuid()` if ever round-tripped through `questionSchema`.
 */

const SAMPLE_CAMPAIGN_ID = "ffffffff-1111-4111-8111-000000000000";

export const multipleChoiceFixture: MultipleChoiceQuestion = {
  id: "aaaaaaaa-1111-4111-8111-000000000001",
  campaignId: SAMPLE_CAMPAIGN_ID,
  prompt: "Apa warna kemasan produk yang ditampilkan dalam video?",
  timerSeconds: 20,
  type: "multiple_choice",
  options: [
    { id: "aaaaaaaa-2222-4222-8222-000000000001", label: "Merah" },
    { id: "aaaaaaaa-2222-4222-8222-000000000002", label: "Biru" },
    { id: "aaaaaaaa-2222-4222-8222-000000000003", label: "Hijau" },
  ],
  correctOptionId: "aaaaaaaa-2222-4222-8222-000000000002",
};

export const trueFalseFixture: TrueFalseQuestion = {
  id: "bbbbbbbb-1111-4111-8111-000000000001",
  campaignId: SAMPLE_CAMPAIGN_ID,
  prompt: "Video ini menjelaskan promo yang berlaku akhir pekan ini.",
  timerSeconds: 15,
  type: "true_false",
  correctAnswer: true,
};

export const likertFixture: LikertQuestion = {
  id: "cccccccc-1111-4111-8111-000000000001",
  campaignId: SAMPLE_CAMPAIGN_ID,
  prompt: "Seberapa besar kemungkinan Anda merekomendasikan merchant ini ke teman?",
  timerSeconds: 20,
  type: "likert",
  scaleMin: 1,
  scaleMax: 5,
  scaleLowLabel: "Sangat tidak mungkin",
  scaleHighLabel: "Sangat mungkin",
};

export const rankedFixture: RankedQuestion = {
  id: "dddddddd-1111-4111-8111-000000000001",
  campaignId: SAMPLE_CAMPAIGN_ID,
  prompt: "Urutkan alasan berikut dari yang paling penting bagi Anda.",
  timerSeconds: 30,
  type: "ranked",
  items: [
    { id: "dddddddd-2222-4222-8222-000000000001", label: "Harga" },
    { id: "dddddddd-2222-4222-8222-000000000002", label: "Kualitas" },
    { id: "dddddddd-2222-4222-8222-000000000003", label: "Kemasan" },
  ],
};

export const shortTextFixture: ShortTextQuestion = {
  id: "eeeeeeee-1111-4111-8111-000000000001",
  campaignId: SAMPLE_CAMPAIGN_ID,
  prompt: "Sebutkan satu hal yang Anda ingat dari video ini.",
  timerSeconds: 25,
  type: "short_text",
  maxLength: 140,
};

/** A minimal, valid campaign fixture for result/scoring tests, with sane overridable defaults. */
export function makeCampaignFixture(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "long_form",
    title: "Contoh Campaign",
    merchantId: "10000000-0000-4000-8000-000000000002",
    merchantName: "Warung Contoh",
    synopsis: "Video contoh untuk pengujian.",
    durationSeconds: 600,
    estimatedDataMb: 210,
    rewardPoints: toPoints(1000),
    questionCount: 4,
    scoringRule: "base_plus_accuracy_bonus",
    status: "active",
    publishedAt: "2026-09-19T09:00:00.000Z",
    ...overrides,
  };
}
