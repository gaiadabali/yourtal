"use client";

import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import type { CampaignChapter } from "./campaign-chapter";
import { createChapter, sortChapters, totalDurationSeconds } from "./campaign-chapter";

export interface CampaignEditorChaptersProps {
  chapters: CampaignChapter[];
  onChange: (chapters: CampaignChapter[]) => void;
  disabled?: boolean;
}

const MIN_CHAPTERS = 1;
const DEFAULT_CHAPTER_GAP_SECONDS = 120;

/**
 * Chapter editing (docs/06-longform-video-and-attention.md §3: "Split every
 * long video into chapters with a reward released at each checkpoint").
 * The video's total duration and estimated data cost are DERIVED from
 * these (`draftDurationSeconds`/`draftEstimatedDataMb` in `campaign-draft.ts`)
 * rather than entered separately, so the two can never silently disagree —
 * the failure mode YT-0411's "terms shown are the terms honoured" exists to
 * prevent.
 */
export function CampaignEditorChapters({
  chapters,
  onChange,
  disabled,
}: CampaignEditorChaptersProps) {
  function updateChapter(id: string, patch: Partial<CampaignChapter>) {
    onChange(
      sortChapters(
        chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...patch } : chapter)),
      ),
    );
  }

  function addChapter() {
    const startSeconds = totalDurationSeconds(chapters) > 0 ? totalDurationSeconds(chapters) : 0;
    onChange(
      sortChapters([
        ...chapters,
        createChapter("", startSeconds + (chapters.length > 0 ? DEFAULT_CHAPTER_GAP_SECONDS : 0)),
      ]),
    );
  }

  function removeChapter(id: string) {
    if (chapters.length <= MIN_CHAPTERS) {
      return;
    }
    onChange(chapters.filter((chapter) => chapter.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {chapters.map((chapter, index) => (
        <div key={chapter.id} className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={`Chapter ${index + 1} title`}
              hideLabel={index > 0}
              placeholder={`Chapter ${index + 1} title`}
              value={chapter.title}
              disabled={disabled}
              onChange={(event) => updateChapter(chapter.id, { title: event.target.value })}
            />
          </div>
          <div className="w-32">
            <Input
              label="Starts at (s)"
              hideLabel={index > 0}
              type="number"
              min={0}
              value={chapter.startSeconds}
              disabled={disabled || index === 0}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed)) {
                  updateChapter(chapter.id, { startSeconds: Math.max(0, Math.round(parsed)) });
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeChapter(chapter.id)}
            disabled={disabled || chapters.length <= MIN_CHAPTERS}
            aria-label={`Remove chapter ${index + 1}`}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={addChapter} disabled={disabled}>
        Add chapter
      </Button>
    </div>
  );
}
