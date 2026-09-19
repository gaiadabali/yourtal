import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { createChapter } from "./campaign-chapter";
import type { CampaignDraft } from "./campaign-draft";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { CampaignEditorReward } from "./campaign-editor-reward";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

function StatefulReward({ initial }: { initial: CampaignDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <RegionProvider region="ID">
      <CampaignEditorReward draft={draft} fieldErrors={{}} onChange={setDraft} />
    </RegionProvider>
  );
}

function draftWithDuration(minutes: number, rewardPoints: number): CampaignDraft {
  const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
  draft.chapters = [createChapter("Intro", 0), createChapter("Close", minutes * 60 - 30)];
  draft.rewardPoints = rewardPoints;
  return draft;
}

describe("CampaignEditorReward", () => {
  it("warns when the reward is trivially small against a long video's data cost", () => {
    render(<StatefulReward initial={draftWithDuration(30, 100)} />);
    expect(screen.getByText("Reward too small")).toBeInTheDocument();
    expect(screen.getByText(/insulting/)).toBeInTheDocument();
  });

  it("shows a fair-trade confirmation when the reward comfortably dwarfs the data cost", () => {
    render(<StatefulReward initial={draftWithDuration(30, 2_500)} />);
    expect(screen.getByText("Fair trade")).toBeInTheDocument();
  });
});
