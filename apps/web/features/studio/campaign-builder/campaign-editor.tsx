"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { Button } from "@yourtal/ui/button";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import { draftDurationPending, draftDurationSeconds, draftFormValues } from "./campaign-draft";
import { campaignDraftFormResolver } from "./campaign-draft-form";
import { isDraftContentEditable } from "./campaign-draft-status";
import { CampaignEditorBudget } from "./campaign-editor-budget";
import { CampaignEditorChapters } from "./campaign-editor-chapters";
import { CampaignEditorDetails } from "./campaign-editor-details";
import { CampaignEditorReward } from "./campaign-editor-reward";
import type { CampaignEditorSection } from "./campaign-editor-sections";
import { CampaignEditorSectionNav } from "./campaign-editor-section-nav";
import { CampaignEditorStatusPanel } from "./campaign-editor-status-panel";
import { CampaignSaveBar } from "./campaign-save-bar";
import type { DetailsSaveState } from "./campaign-save-bar";
import { CampaignEditorTargeting } from "./campaign-editor-targeting";
import { CampaignEditorBoost } from "../boost/campaign-editor-boost";
import { CampaignEditorUpload } from "./campaign-editor-upload";
import { CampaignEntryPreview } from "./campaign-entry-preview";
import { QuestionBankScreen } from "../question-bank/question-bank-screen";

export interface CampaignEditorProps {
  draft: CampaignDraft;
  onChange: (draft: CampaignDraft) => void;
  /**
   * Applies a change on top of the latest draft. For anything that arrives after a wait (a
   * video's progress, a saved reward, a saved question): `draft` in this render may be older
   * than the author's last edit, and writing it back would undo that edit.
   */
  onPatch: (patch: Partial<CampaignDraft>) => void;
  onBack: () => void;
  /** Saves the details and targeting now (a no-op when nothing is waiting); Submit and leaving a tab call it so nothing typed is lost. */
  onSave?: () => Promise<string | null>;
  /** Live: whether the details and targeting are saved, shown beside a Save button on those tabs. */
  detailsSave?: DetailsSaveState;
  canEdit: boolean;
  isVerified: boolean;
  isLiveMode: boolean;
  allocations: BillingAllocation[];
}

/**
 * One campaign's full builder: details, upload & chapters, reward,
 * targeting, budget and question bank behind a small hand-built tab
 * switcher (`campaign-editor-section-nav.tsx`), with the status panel and
 * the live entry-card preview always visible beside them — never behind an
 * extra click, since surfacing the authoring-time consequence (YT-0441's
 * brief) only works if the advertiser sees it while they are still
 * changing the numbers that drive it.
 *
 * Title, synopsis, reward and total budget are the one React Hook Form
 * instance for this whole editor (YT-0525) — created here, once, because
 * those four fields are split across three of the tabs below
 * (`CampaignEditorDetails`, `CampaignEditorReward`, `CampaignEditorBudget`),
 * which mount and unmount as `section` changes; a form created inside any
 * one of them would lose its state every time the author switched away and
 * back. `values` keeps it synced to `draft` (the actual source of truth,
 * still owned by `campaign-builder-screen.tsx`'s `useState`) rather than
 * the reverse, since autosave, the status panel and the live preview all
 * read `draft`, not the form. `form` is passed down as a plain prop, not
 * `FormProvider`/context — docs/13b-typescript-standards.md §8 reserves
 * Context for "ambient, rarely-changing values"; form state changes on
 * every keystroke, which is exactly what that rule is warning against.
 */
export function CampaignEditor({
  draft,
  onChange: onChangeDraft,
  onPatch,
  onBack,
  onSave,
  detailsSave,
  canEdit,
  isVerified,
  isLiveMode,
  allocations,
}: CampaignEditorProps) {
  const t = useTranslations("studio");
  const [section, setSection] = useState<CampaignEditorSection>("details");
  // Counts the author's own edits, so a refusal on screen can tell it no longer matches them.
  const [revision, setRevision] = useState(0);
  function onChange(next: CampaignDraft) {
    setRevision((count) => count + 1);
    onChangeDraft(next);
  }
  /** Leaving a tab saves what was typed on it, so nothing waits on the timer. */
  function changeSection(next: CampaignEditorSection) {
    if (next !== section) void onSave?.();
    setSection(next);
  }
  const editable = canEdit && isDraftContentEditable(draft.status);
  const form = useForm<CampaignDraftFormValues>({
    values: draftFormValues(draft),
    resolver: campaignDraftFormResolver,
    mode: "onChange",
  });

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        {t("campaignBuilder.editor.backToCampaigns")}
      </Button>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <CampaignEditorSectionNav active={section} onChange={changeSection} />

          <div
            role="tabpanel"
            id={`campaign-editor-panel-${section}`}
            aria-labelledby={`campaign-editor-tab-${section}`}
          >
            {section === "details" ? (
              <CampaignEditorDetails
                draft={draft}
                form={form}
                onChange={onChange}
                disabled={!editable}
              />
            ) : null}
            {section === "video" ? (
              <div className="flex flex-col gap-6">
                <CampaignEditorUpload
                  video={draft.video}
                  onChange={(video) => onPatch({ video })}
                  disabled={!editable}
                  businessId={draft.businessId}
                  campaignId={draft.id}
                  teaserStartSeconds={draft.teaserStartSeconds}
                  isLiveMode={isLiveMode}
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
                form={form}
                onChange={onChange}
                onPatch={onPatch}
                disabled={!editable}
                isLiveMode={isLiveMode}
                merchantName={draft.merchantName}
                allocations={allocations}
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
                draft={draft}
                form={form}
                onChange={onChange}
                onPatch={onPatch}
                disabled={!editable}
                isLiveMode={isLiveMode}
                merchantName={draft.merchantName}
              />
            ) : null}
            {section === "boost" ? (
              <CampaignEditorBoost
                businessId={draft.businessId}
                campaignId={draft.id}
                isLive={draft.status === "live"}
                isLiveMode={isLiveMode}
              />
            ) : null}
            {section === "questions" ? (
              <QuestionBankScreen
                businessId={draft.businessId}
                campaignId={draft.id}
                durationSeconds={draftDurationSeconds(draft)}
                initialBank={draft.questionBank}
                onBankChange={(questionBank) => onPatch({ questionBank })}
                readOnly={!editable}
                isLiveMode={isLiveMode}
                audience={draft.audience}
              />
            ) : null}
          </div>

          {isLiveMode &&
          editable &&
          detailsSave &&
          (section === "details" || section === "targeting") ? (
            <CampaignSaveBar state={detailsSave} onSave={() => void onSave?.()} />
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <CampaignEditorStatusPanel
            draft={draft}
            onChange={onChange}
            section={section}
            revision={revision}
            {...(onSave ? { onSave } : {})}
            canEdit={canEdit}
            isVerified={isVerified}
            isLiveMode={isLiveMode}
            businessId={draft.businessId}
            campaignId={draft.id}
            merchantName={draft.merchantName}
          />
          <CampaignEntryPreview
            draft={draft}
            durationPending={draftDurationPending(draft, isLiveMode)}
          />
        </div>
      </div>
    </div>
  );
}
