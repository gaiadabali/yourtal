import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { StudioIntlProvider } from "../studio-test-i18n";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import { draftFormValues } from "./campaign-draft";
import { campaignDraftFormResolver } from "./campaign-draft-form";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { CampaignEditorDetails } from "./campaign-editor-details";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000701";

/**
 * TASKS.md 12.3.a: the audience/category pickers show the 1.1.d policy
 * inline. Same harness `campaign-editor-reward.test.tsx` already uses --
 * one shared React Hook Form instance, `RegionProvider` standing in for
 * `campaign-editor.tsx`'s real ambient region.
 */
function StatefulDetails({
  initial,
  region = "AU",
}: {
  initial: CampaignDraft;
  region?: "AU" | "ID";
}) {
  const [draft, setDraft] = useState(initial);
  const form = useForm<CampaignDraftFormValues>({
    values: draftFormValues(draft),
    resolver: campaignDraftFormResolver,
    mode: "onChange",
  });
  return (
    <StudioIntlProvider>
      <RegionProvider region={region}>
        <CampaignEditorDetails draft={draft} form={form} onChange={setDraft} />
      </RegionProvider>
    </StudioIntlProvider>
  );
}

function baseDraft(): CampaignDraft {
  return createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
}

describe("CampaignEditorDetails", () => {
  it("shows what the currently selected audience reaches", () => {
    const draft = baseDraft();
    draft.audience = "teen";
    render(<StatefulDetails initial={draft} />);
    expect(screen.getByText(/Reaches only viewers aged 13/)).toBeInTheDocument();
  });

  it("forces audience to Adult and explains why when an adult_only category is picked (AU)", () => {
    render(<StatefulDetails initial={baseDraft()} />);
    const categorySelect = screen.getByLabelText("Category");
    const audienceSelect = screen.getByLabelText<HTMLSelectElement>("Audience");

    // alcohol is adult_only in AU (1.1.d) -- not prohibited, so selectable.
    categorySelect.dispatchEvent(new Event("focusin", { bubbles: true }));
    (categorySelect as HTMLSelectElement).value = "alcohol";
    categorySelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(audienceSelect.value).toBe("adult");
    expect(audienceSelect).toBeDisabled();
    expect(screen.getByText(/adult-only in Australia/)).toBeInTheDocument();
  });

  it("disables a prohibited category's own option (tobacco in AU)", () => {
    render(<StatefulDetails initial={baseDraft()} />);
    const tobaccoOption = screen.getByRole<HTMLOptionElement>("option", {
      name: /tobacco/i,
    });
    expect(tobaccoOption).toBeDisabled();
  });

  it("prohibits a different category per region -- gambling is prohibited in ID but only adult_only in AU", () => {
    render(<StatefulDetails initial={baseDraft()} region="ID" />);
    const gamblingOption = screen.getByRole<HTMLOptionElement>("option", { name: /gambling/i });
    expect(gamblingOption).toBeDisabled();
  });
});
