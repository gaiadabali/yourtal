import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { StudioIntlProvider } from "../studio-test-i18n";
import { createChapter } from "./campaign-chapter";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import { draftFormValues } from "./campaign-draft";
import { campaignDraftFormResolver } from "./campaign-draft-form";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { CampaignEditorReward } from "./campaign-editor-reward";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

/**
 * `CampaignEditorReward` takes the same shared React Hook Form instance
 * `campaign-editor.tsx` creates for the real editor (YT-0525) — this
 * harness stands one up the same way, `values`-synced to local `draft`
 * state, so this test still exercises the component in isolation rather
 * than through the full `CampaignEditor` tree.
 */
function StatefulReward({ initial }: { initial: CampaignDraft }) {
  const [draft, setDraft] = useState(initial);
  const form = useForm<CampaignDraftFormValues>({
    values: draftFormValues(draft),
    resolver: campaignDraftFormResolver,
    mode: "onChange",
  });
  return (
    <StudioIntlProvider>
      <RegionProvider region="ID">
        <CampaignEditorReward
          draft={draft}
          form={form}
          onChange={setDraft}
          isLiveMode={false}
          merchantName="Kopi Kenangan"
          allocations={[]}
        />
      </RegionProvider>
    </StudioIntlProvider>
  );
}

function draftWithDuration(minutes: number, rewardPoints: number): CampaignDraft {
  const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
  draft.chapters = [createChapter("Intro", 0), createChapter("Close", minutes * 60 - 30)];
  draft.rewardPoints = rewardPoints;
  return draft;
}

describe("CampaignEditorReward", () => {
  // task 7.8.c: B (the backing rate) no longer computes a reward's money
  // value client-side, so the ratio banner is honestly "pending" regardless
  // of the points entered, until a server endpoint supplies that value
  // (`campaign-reward-risk.ts`'s doc comment).
  it("shows the ratio as pending rather than guessing it from points alone", () => {
    render(<StatefulReward initial={draftWithDuration(30, 100)} />);
    expect(screen.getByText("Ratio pending")).toBeInTheDocument();
    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument();
  });

  it("still shows pending for a large reward — no client-side guess either way", () => {
    render(<StatefulReward initial={draftWithDuration(30, 2_500)} />);
    expect(screen.getByText("Ratio pending")).toBeInTheDocument();
  });
});
