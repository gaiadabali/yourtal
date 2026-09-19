import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { createChapter } from "./campaign-chapter";
import type { CampaignDraft } from "./campaign-draft";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { CampaignEditor } from "./campaign-editor";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

function StatefulEditor({
  initial,
  canEdit = true,
}: {
  initial: CampaignDraft;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <RegionProvider region="ID">
      <CampaignEditor draft={draft} onChange={setDraft} onBack={vi.fn()} canEdit={canEdit} />
    </RegionProvider>
  );
}

function baseDraft(): CampaignDraft {
  const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
  draft.title = "Cold Brew Launch";
  draft.synopsis = "Introduces the new cold brew line.";
  draft.chapters = [createChapter("Intro", 0), createChapter("Close", 300)];
  draft.rewardPoints = 800;
  return draft;
}

describe("CampaignEditor", () => {
  it("renders the details tab by default with the preview always visible beside it", () => {
    render(<StatefulEditor initial={baseDraft()} />);
    expect(screen.getByRole("textbox", { name: "Campaign title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cold Brew Launch" })).toBeInTheDocument();
  });

  it("switches to the reward tab and the preview reflects a changed reward", async () => {
    render(<StatefulEditor initial={baseDraft()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Reward" }));
    const rewardInput = screen.getByRole("spinbutton", { name: "Reward (points)" });
    await userEvent.clear(rewardInput);
    await userEvent.type(rewardInput, "2500");
    expect(screen.getByText(/2\.500|2,500/)).toBeInTheDocument();
  });

  it("disables editing fields when the campaign is live", () => {
    const draft = { ...baseDraft(), status: "live" as const };
    render(<StatefulEditor initial={draft} />);
    expect(screen.getByRole("textbox", { name: "Campaign title" })).toBeDisabled();
  });

  it("hides workflow actions entirely when the viewer cannot edit", () => {
    render(<StatefulEditor initial={baseDraft()} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
  });

  it("shows the Questions tab hosting the question bank screen", async () => {
    render(<StatefulEditor initial={baseDraft()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Questions" }));
    expect(screen.getByRole("heading", { name: "Question bank" })).toBeInTheDocument();
  });
});
