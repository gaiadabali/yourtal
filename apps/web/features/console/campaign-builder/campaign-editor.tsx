"use client";

import { useState } from "react";
import { Button } from "@yourtal/ui/button";
import type { CampaignDraft } from "./campaign-draft";
import { draftDurationSeconds, validateCampaignDraftForm } from "./campaign-draft";
import { isDraftContentEditable } from "./campaign-draft-status";
import { CampaignEditorBudget } from "./campaign-editor-budget";
import { CampaignEditorChapters } from "./campaign-editor-chapters";
import { CampaignEditorDetails } from "./campaign-editor-details";
import { CampaignEditorReward } from "./campaign-editor-reward";
import type { CampaignEditorSection } from "./campaign-editor-sections";
import { CampaignEditorSectionNav } from "./campaign-editor-section-nav";
import { CampaignEditorStatusPanel } from "./campaign-editor-status-panel";
import { CampaignEditorTargeting } from "./campaign-editor-targeting";
import { CampaignEditorUpload } from "./campaign-editor-upload";
import { CampaignEntryPreview } from "./campaign-entry-preview";
import { QuestionBankScreen } from "../question-bank/question-bank-screen";

export interface CampaignEditorProps {
  draft: CampaignDraft;
  onChange: (draft: CampaignDraft) => void;
  onBack: () => void;
  canEdit: boolean;
}

/**
 * One campaign's full builder: details, upload & chapters, reward,
 * targeting, budget and question bank behind a small hand-built tab
 * switcher (`campaign-editor-section-nav.tsx`), with the status panel and
 * the live entry-card preview always visible beside them — never behind an
 * extra click, since surfacing the authoring-time consequence (YT-0441's
 * brief) only works if the advertiser sees it while they are still
 * changing the numbers that drive it.
 */
export function CampaignEditor({ draft, onChange, onBack, canEdit }: CampaignEditorProps) {
  const [section, setSection] = useState<CampaignEditorSection>("details");
  const editable = canEdit && isDraftContentEditable(draft.status);
  const fieldErrors = validateCampaignDraftForm(draft);

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        ← Back to campaigns
      </Button>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <CampaignEditorSectionNav active={section} onChange={setSection} />

          <div
            role="tabpanel"
            id={`campaign-editor-panel-${section}`}
            aria-labelledby={`campaign-editor-tab-${section}`}
          >
            {section === "details" ? (
              <CampaignEditorDetails
                draft={draft}
                fieldErrors={fieldErrors}
                onChange={onChange}
                disabled={!editable}
              />
            ) : null}
            {section === "video" ? (
              <div className="flex flex-col gap-6">
                <CampaignEditorUpload
                  video={draft.video}
                  onChange={(video) => onChange({ ...draft, video })}
                  disabled={!editable}
                />
                <CampaignEditorChapters
                  chapters={draft.chapters}
                  onChange={(chapters) => onChange({ ...draft, chapters })}
                  disabled={!editable}
                />
              </div>
            ) : null}
            {section === "reward" ? (
              <CampaignEditorReward
                draft={draft}
                fieldErrors={fieldErrors}
                onChange={onChange}
                disabled={!editable}
              />
            ) : null}
            {section === "targeting" ? (
              <CampaignEditorTargeting
                targeting={draft.targeting}
                onChange={(targeting) => onChange({ ...draft, targeting })}
                disabled={!editable}
              />
            ) : null}
            {section === "budget" ? (
              <CampaignEditorBudget
                budget={draft.budget}
                fieldErrors={fieldErrors}
                onChange={(budget) => onChange({ ...draft, budget })}
                disabled={!editable}
              />
            ) : null}
            {section === "questions" ? (
              <QuestionBankScreen
                campaignId={draft.id}
                durationSeconds={draftDurationSeconds(draft)}
                initialBank={draft.questionBank}
                onBankChange={(questionBank) => onChange({ ...draft, questionBank })}
                readOnly={!editable}
              />
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <CampaignEditorStatusPanel draft={draft} onChange={onChange} canEdit={canEdit} />
          <CampaignEntryPreview draft={draft} />
        </div>
      </div>
    </div>
  );
}
