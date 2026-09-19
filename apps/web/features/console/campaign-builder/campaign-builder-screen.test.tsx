import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { buildDemoCampaignDrafts } from "./campaign-draft-fixtures";
import { CampaignBuilderScreen } from "./campaign-builder-screen";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

function renderScreen(canEdit = true) {
  const drafts = buildDemoCampaignDrafts(BUSINESS_ID, "Kopi Kenangan");
  return render(
    <RegionProvider region="ID">
      <CampaignBuilderScreen
        businessId={BUSINESS_ID}
        merchantName="Kopi Kenangan"
        initialDrafts={drafts}
        canEdit={canEdit}
      />
    </RegionProvider>,
  );
}

describe("CampaignBuilderScreen", () => {
  it("starts on the campaign list", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "Campaigns" })).toBeInTheDocument();
  });

  it("opens a campaign into its editor and back again", async () => {
    renderScreen();
    const draftTitle = "Kopi Kenangan — Cold Brew Launch";
    await userEvent.click(screen.getByRole("button", { name: new RegExp(draftTitle) }));
    expect(screen.getByRole("textbox", { name: "Campaign title" })).toHaveValue(draftTitle);

    await userEvent.click(screen.getByRole("button", { name: "← Back to campaigns" }));
    expect(screen.getByRole("heading", { name: "Campaigns" })).toBeInTheDocument();
  });

  it("creates a new draft and opens it directly into the editor", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(screen.getByRole("textbox", { name: "Campaign title" })).toHaveValue("");
  });

  it("read-only viewers never see New campaign and cannot open the editor's edit controls", () => {
    renderScreen(false);
    expect(screen.queryByRole("button", { name: "New campaign" })).not.toBeInTheDocument();
  });
});
