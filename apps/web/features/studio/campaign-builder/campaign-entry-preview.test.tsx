import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { StudioIntlProvider } from "../studio-test-i18n";
import { createChapter } from "./campaign-chapter";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { liveDraft } from "./campaign-draft-live-fixtures";
import { CampaignEntryPreview } from "./campaign-entry-preview";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

describe("CampaignEntryPreview", () => {
  it("renders the real entry card's title, synopsis and merchant name from the draft", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    draft.title = "Cold Brew Launch";
    draft.synopsis = "Introduces the new cold brew line.";
    draft.chapters = [createChapter("Intro", 0), createChapter("Close", 300)];
    draft.rewardPoints = 800;

    render(
      <StudioIntlProvider>
        <RegionProvider region="ID">
          <CampaignEntryPreview draft={draft} />
        </RegionProvider>
      </StudioIntlProvider>,
    );

    expect(screen.getByRole("heading", { name: "Cold Brew Launch" })).toBeInTheDocument();
    expect(screen.getByText("Introduces the new cold brew line.")).toBeInTheDocument();
    expect(screen.getByText("Kopi Kenangan")).toBeInTheDocument();
  });

  it("updates the preview's reward text as the draft's reward changes", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
    draft.title = "Loyalty Explainer";
    draft.synopsis = "How the loyalty card works.";
    draft.chapters = [createChapter("Intro", 0), createChapter("Close", 300)];
    draft.rewardPoints = 1_500;

    render(
      <StudioIntlProvider>
        <RegionProvider region="ID">
          <CampaignEntryPreview draft={draft} />
        </RegionProvider>
      </StudioIntlProvider>,
    );

    expect(screen.getByText(/1\.500|1,500/)).toBeInTheDocument();
  });

  // B9: a placeholder length (a chapter laid out before the video exists) is not a length.
  it("shows the length, data cost and questions as pending until the video's real length is known", () => {
    const draft = {
      ...liveDraft(),
      title: "Pending video",
      chapters: [createChapter("Intro", 0)],
    };
    render(
      <StudioIntlProvider>
        <RegionProvider region="AU">
          <CampaignEntryPreview draft={draft} durationPending />
        </RegionProvider>
      </StudioIntlProvider>,
    );

    expect(screen.getAllByText("Pending")).toHaveLength(3);
    expect(screen.queryByText("30 sec")).not.toBeInTheDocument();
    expect(screen.queryByText("1 min")).not.toBeInTheDocument();
    expect(screen.queryByText(/MB/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^(No questions|[0-9]+ questions?)$/)).not.toBeInTheDocument();
    expect(screen.getByText("Data cost pending")).toBeInTheDocument();
  });

  // B3: the card never shows an unsaved number as if it were the saved one.
  it("marks a reward that is not saved yet", () => {
    const draft = {
      ...liveDraft({ durationSeconds: 20, hlsUrl: "https://media.test/index.m3u8" }),
      title: "Reward on screen",
      rewardPoints: 5,
    };
    render(
      <StudioIntlProvider>
        <RegionProvider region="AU">
          <CampaignEntryPreview draft={draft} />
        </RegionProvider>
      </StudioIntlProvider>,
    );

    expect(screen.getByText("5 points (not saved)")).toBeInTheDocument();
    expect(screen.getByText("The reward shown here is not saved yet.")).toBeInTheDocument();
  });

  it("does not mark a reward that matches what is saved", () => {
    const draft = {
      ...liveDraft({
        durationSeconds: 20,
        hlsUrl: "https://media.test/index.m3u8",
        rewardPoints: 2,
        rewardConfig: {
          allocationId: "alloc-1",
          rewardPointsPerCompletion: 2,
          accuracyBonusPoints: 0,
          maxPointsForCampaign: 100,
          dailyCapPoints: null,
        },
      }),
      title: "Saved reward",
    };
    render(
      <StudioIntlProvider>
        <RegionProvider region="AU">
          <CampaignEntryPreview draft={draft} />
        </RegionProvider>
      </StudioIntlProvider>,
    );

    expect(screen.getByText("2 points")).toBeInTheDocument();
    expect(screen.queryByText(/not saved/)).not.toBeInTheDocument();
  });

  // B5: the preview used to treat points as money and report a ratio the Reward tab said was pending.
  it("gives a 0-point draft the same kind message as the Reward tab, not a ratio", () => {
    const draft = { ...liveDraft({ durationSeconds: 20 }), title: "No reward yet" };
    render(
      <StudioIntlProvider>
        <RegionProvider region="AU">
          <CampaignEntryPreview draft={{ ...draft, video: { ...draft.video, status: "ready" } }} />
        </RegionProvider>
      </StudioIntlProvider>,
    );

    expect(screen.getByText(/Set a reward to see how it compares/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/insult|0x/i);
  });
});
