import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { createChapter } from "./campaign-chapter";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
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
      <RegionProvider region="ID">
        <CampaignEntryPreview draft={draft} />
      </RegionProvider>,
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
      <RegionProvider region="ID">
        <CampaignEntryPreview draft={draft} />
      </RegionProvider>,
    );

    expect(screen.getByText(/1\.500|1,500/)).toBeInTheDocument();
  });
});
