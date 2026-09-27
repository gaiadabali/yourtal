"use client";

import { useState } from "react";
import type { CampaignDraft } from "./campaign-draft";
import { CampaignDraftList } from "./campaign-draft-list";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import {
  createCampaignDraftLive,
  updateCampaignDraftDetailsLive,
} from "./campaign-builder-actions";
import dynamic from "next/dynamic";
import { Skeleton } from "@yourtal/ui/skeleton";

// The editor (form, reward-risk, upload, preview) only renders once a draft is
// opened, so it loads then instead of in the list's initial JS. It kept
// /business/campaigns over its 200 KB budget (2.4.h, F38).
const CampaignEditor = dynamic(
  () => import("./campaign-editor").then((editorModule) => editorModule.CampaignEditor),
  { loading: () => <Skeleton className="h-96 w-full rounded-lg" /> },
);

export interface CampaignBuilderScreenProps {
  businessId: string;
  merchantName: string;
  initialDrafts: CampaignDraft[];
  canEdit: boolean;
  /** Whether the business has passed KYB review — gates the "Submit for review" action (7.3.d, red line 7). */
  isVerified: boolean;
  /** `YOURTAL_DATA_SOURCE === "live"` — threaded down to `CampaignEditorUpload`, the one leaf that needs to pick between the real upload (7.8.b) and the mock simulation. */
  isLiveMode: boolean;
}

/**
 * The Campaigns zone (YT-0441): the campaign list and, once one is opened,
 * its full builder — the one client leaf for this whole zone, mirroring
 * `features/studio/team-screen.tsx`'s "one leaf owns the whole flow"
 * shape. No live campaign API exists yet (Phase U is mock-only), so every
 * edit lives in this component's own `useState` array; the moment a real
 * BFF exists, only this component's persistence calls change.
 */
export function CampaignBuilderScreen({
  businessId,
  merchantName,
  initialDrafts,
  canEdit,
  isVerified,
  isLiveMode,
}: CampaignBuilderScreenProps) {
  const [drafts, setDrafts] = useState<CampaignDraft[]>(initialDrafts);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  function updateDraft(next: CampaignDraft) {
    setDrafts((current) => current.map((draft) => (draft.id === next.id ? next : draft)));
  }

  async function createDraft() {
    if (isLiveMode) {
      const result = await createCampaignDraftLive(businessId, merchantName);
      if (!result.ok) {
        setCreateError(result.message);
        return;
      }
      setCreateError(null);
      setDrafts((current) => [result.value, ...current]);
      setOpenDraftId(result.value.id);
      return;
    }
    const draft = createEmptyCampaignDraft(businessId, merchantName);
    setDrafts((current) => [draft, ...current]);
    setOpenDraftId(draft.id);
  }

  /**
   * Flushes the details tab's title/synopsis to the real draft on the way
   * out of the editor, rather than on every keystroke (`@NotValueMoving`,
   * so a repeat is harmless, but a PATCH per character is still wasted
   * work). The rest of the editor's fields (reward, targeting, budget,
   * questions, schedule/audience/category/teaser/captions) stay local-only
   * this pass — see `campaign-draft-live-mapping.ts`'s own doc comment.
   */
  async function closeEditor() {
    const current = drafts.find((draft) => draft.id === openDraftId);
    if (isLiveMode && current) {
      const result = await updateCampaignDraftDetailsLive(businessId, current.id, merchantName, {
        title: current.title,
        synopsis: current.synopsis,
      });
      if (result.ok) {
        updateDraft(result.value);
      }
      // A save hiccup on the way out is not worth trapping the author in
      // the editor over — the list's own next live fetch shows whatever
      // the server actually holds either way.
    }
    setOpenDraftId(null);
  }

  const openDraft = drafts.find((draft) => draft.id === openDraftId);

  if (openDraft) {
    return (
      <CampaignEditor
        draft={openDraft}
        onChange={updateDraft}
        onBack={() => void closeEditor()}
        canEdit={canEdit}
        isVerified={isVerified}
        isLiveMode={isLiveMode}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {createError ? (
        <p role="alert" className="text-sm font-sans text-danger">
          {createError}
        </p>
      ) : null}
      <CampaignDraftList
        drafts={drafts}
        onOpen={setOpenDraftId}
        onCreate={() => void createDraft()}
        canEdit={canEdit}
      />
    </div>
  );
}
