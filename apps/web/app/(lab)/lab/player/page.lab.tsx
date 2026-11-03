"use client";

import {
  CheckpointOverlay,
  CheckpointStage,
  PLAYER_BOX_CLASS,
} from "@/features/player/checkpoint-overlay";
import type { SupportedLocale } from "@/features/player/player-i18n";

/**
 * `/lab/player`: the real checkpoint question inside the watch page's own
 * column and stage, once per language, with long options. The rendered gate
 * measures it at 390 px and 1280 px (rendered/player-checkpoint.spec.ts). The
 * only stand-in is the picture itself; the video element is not needed to
 * lay out what sits over or under it.
 */
const QUESTIONS: Record<SupportedLocale, { prompt: string; options: string[] }> = {
  "en-AU": {
    prompt: "Which of these did the presenter say about how local brands share their rewards?",
    options: [
      "Rewards come from local brands who want you to know what they make",
      "Every reward is paid for by the people watching the other videos on the platform",
      "Nothing is paid out until the whole video has been watched with the sound turned on",
    ],
  },
  "id-ID": {
    prompt:
      "Manakah di bawah ini yang disebutkan pembawa acara tentang cara merek lokal membagikan reward?",
    options: [
      "Reward berasal dari merek lokal yang ingin kamu tahu apa yang mereka buat",
      "Setiap reward dibayar oleh orang-orang yang menonton video lain di platform ini",
      "Tidak ada yang dibayarkan sampai seluruh video ditonton dengan suara menyala",
    ],
  },
};

export default function LabPlayerPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6">
      {(Object.keys(QUESTIONS) as SupportedLocale[]).map((locale) => {
        const { prompt, options } = QUESTIONS[locale];
        return (
          <section key={locale} data-testid={`stage-${locale}`} className="flex flex-col gap-4">
            <h1 className="text-xl font-sans font-semibold text-fg">{locale}</h1>
            <CheckpointStage>
              <div className={PLAYER_BOX_CLASS} data-testid={`video-${locale}`}>
                <div className="h-full w-full bg-surface-sunken" />
              </div>
              <CheckpointOverlay
                question={{
                  id: `lab-${locale}`,
                  campaignId: "00000000-0000-4000-8000-000000000000",
                  prompt,
                  timerSeconds: 30,
                  type: "multiple_choice",
                  options: options.map((label, index) => ({
                    id: `option-${String(index)}`,
                    label,
                  })),
                }}
                questionNumber={1}
                totalQuestions={1}
                // Long enough that the page is measured before it counts down.
                answerTimerMs={3_600_000}
                onAnswer={() => undefined}
                locale={locale}
              />
            </CheckpointStage>
          </section>
        );
      })}
    </div>
  );
}
