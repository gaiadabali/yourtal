import { CheckpointQuiz } from "@/features/checkpoint/checkpoint-quiz";
import { getCheckpointData } from "@/features/checkpoint/checkpoint-data";

export interface CheckpointPageProps {
  params: Promise<{ campaignId: string }>;
}

/**
 * YT-0413 — the checkpoint route the player (YT-0412) hands off into at
 * the end of playback. Server Component: loads the campaign and its
 * question bank, then renders the one client leaf that runs the
 * conversational quiz (docs/13b-typescript-standards.md section 8 —
 * `"use client"` never belongs on `page.tsx` itself).
 *
 * `getCheckpointData` never dead-ends in mock mode (it mirrors the
 * player's own "never dead-end on an unknown id" behaviour — see
 * `checkpoint-data.ts`), so there is no not-found branch to handle here
 * today. `error.tsx` in this route segment still catches a `live`-mode
 * throw once that data source exists.
 */
export default async function CheckpointPage({ params }: CheckpointPageProps) {
  const { campaignId } = await params;
  const { campaign, questions } = getCheckpointData(campaignId);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 pb-24">
      <CheckpointQuiz campaign={campaign} questions={questions} />
    </main>
  );
}
