import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { StudioIntlProvider } from "../studio-test-i18n";
import { CampaignDraftList } from "./campaign-draft-list";
import { buildDemoCampaignDrafts } from "./campaign-draft-fixtures";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

function renderWithIntl(ui: ReactElement) {
  return render(<StudioIntlProvider>{ui}</StudioIntlProvider>);
}

describe("CampaignDraftList", () => {
  it("shows an empty state with no drafts", () => {
    renderWithIntl(<CampaignDraftList drafts={[]} onOpen={vi.fn()} onCreate={vi.fn()} canEdit />);
    expect(screen.getByText("No campaigns yet.")).toBeInTheDocument();
  });

  it("renders every status badge across the fixed demo fixtures (all five workflow states)", () => {
    const drafts = buildDemoCampaignDrafts(BUSINESS_ID, "Kopi Kenangan");
    renderWithIntl(
      <CampaignDraftList drafts={drafts} onOpen={vi.fn()} onCreate={vi.fn()} canEdit />,
    );
    for (const label of ["Draft", "In review", "Live", "Paused", "Rejected"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("shows the rejection reason on a rejected campaign's own row", () => {
    const drafts = buildDemoCampaignDrafts(BUSINESS_ID, "Kopi Kenangan");
    const rejected = drafts.find((draft) => draft.status === "rejected");
    renderWithIntl(
      <CampaignDraftList drafts={drafts} onOpen={vi.fn()} onCreate={vi.fn()} canEdit />,
    );
    expect(screen.getByText(rejected?.rejectionReason ?? "")).toBeInTheDocument();
  });

  it("opens a draft when its row is clicked", async () => {
    const drafts = buildDemoCampaignDrafts(BUSINESS_ID, "Kopi Kenangan");
    const onOpen = vi.fn();
    renderWithIntl(
      <CampaignDraftList drafts={drafts} onOpen={onOpen} onCreate={vi.fn()} canEdit />,
    );
    const firstDraft = drafts[0];
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(firstDraft?.title ?? "") }),
    );
    expect(onOpen).toHaveBeenCalledWith(firstDraft?.id);
  });

  it("hides New campaign when the viewer cannot edit", () => {
    renderWithIntl(
      <CampaignDraftList drafts={[]} onOpen={vi.fn()} onCreate={vi.fn()} canEdit={false} />,
    );
    expect(screen.queryByRole("button", { name: "New campaign" })).not.toBeInTheDocument();
  });
});
