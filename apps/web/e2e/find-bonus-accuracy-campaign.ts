import type { Campaign } from "@yourtal/contracts/campaign";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { generateQuestions } from "@yourtal/contracts/question/mock";

/**
 * Shared by earn-journey.spec.ts and open-view-journey.spec.ts: a
 * `long_form` campaign that both scores `base_plus_accuracy_bonus` AND
 * whose generated checkpoint question bank actually contains a scorable
 * question (`multiple_choice`/`true_false` — `docs/06` section 4.1). Both
 * properties are required: `checkpoint-result.tsx` hides the whole bonus
 * row whenever `accuracyFraction` is `null`, which happens for
 * `base_only` campaigns AND for any `base_plus_accuracy_bonus` campaign
 * whose questions happen to all be likert/ranked/short_text (opinion
 * types, never scored). A campaign satisfying only `scoringRule` can still
 * render "Campaign ini tidak memiliki bonus akurasi" — this was found
 * empirically running this exact suite.
 *
 * `hashCampaignIdForQuestions` below is a deliberate, byte-for-byte copy
 * of the private function of the same name in
 * `features/checkpoint/checkpoint-data.ts` — that file's own comment
 * explains why it exists as a small local duplicate rather than a shared
 * export (feature folders don't share code across owners in that ticket's
 * scope). Reproducing it here is what lets this test compute the exact
 * same question bank the checkpoint route itself will render for a given
 * campaign id, so the selection below matches reality instead of guessing.
 */
function hashCampaignIdForQuestions(campaignId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < campaignId.length; index += 1) {
    hash ^= campaignId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hasScorableQuestion(campaign: Campaign): boolean {
  if (campaign.questionCount === 0) {
    return false;
  }
  const questions = generateQuestions(
    campaign.questionCount,
    hashCampaignIdForQuestions(campaign.id),
    campaign.id,
  );
  return questions.some(
    (question) => question.type === "multiple_choice" || question.type === "true_false",
  );
}

export function findBonusAccuracyCampaign(): Campaign {
  const campaign = mockCampaigns.find(
    (candidate) =>
      candidate.kind === "long_form" &&
      candidate.scoringRule === "base_plus_accuracy_bonus" &&
      hasScorableQuestion(candidate),
  );
  if (!campaign) {
    throw new Error(
      "expected at least one long_form campaign with scoringRule base_plus_accuracy_bonus AND a scorable checkpoint question in mockCampaigns — the checkpoint's own base/bonus split would have nothing to demonstrate either",
    );
  }
  return campaign;
}
