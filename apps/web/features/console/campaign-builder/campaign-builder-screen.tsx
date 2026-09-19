"use client";

import { useState } from "react";
import type { CampaignDraft } from "./campaign-draft";
import { CampaignDraftList } from "./campaign-draft-list";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { CampaignEditor } from "./campaign-editor";

export interface CampaignBuilderScreenProps {
  businessId: string;
  merchantName: string;
  initialDrafts: CampaignDraft[];
  canEdit: boolean;
}

/**
 * The Campaigns zone (YT-0441): the campaign list and, once one is opened,
 * its full builder — the one client leaf for this whole zone, mirroring
 * `features/console/team-screen.tsx`'s "one leaf owns the whole flow"
 * shape. No live campaign API exists yet (Phase U is mock-only), so every
 * edit lives in this component's own `useState` array; the moment a real
 * BFF exists, only this component's persistence calls change.
 */
export function CampaignBuilderScreen({
  businessId,
  merchantName,
  initialDrafts,
  canEdit,
}: CampaignBuilderScreenProps) {
  const [drafts, setDrafts] = useState<CampaignDraft[]>(initialDrafts);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);

  function updateDraft(next: CampaignDraft) {
    setDrafts((current) => current.map((draft) => (draft.id === next.id ? next : draft)));
  }

  function createDraft() {
    const draft = createEmptyCampaignDraft(businessId, merchantName);
    setDrafts((current) => [draft, ...current]);
    setOpenDraftId(draft.id);
  }

  const openDraft = drafts.find((draft) => draft.id === openDraftId);

  if (openDraft) {
    return (
      <CampaignEditor
        draft={openDraft}
        onChange={updateDraft}
        onBack={() => setOpenDraftId(null)}
        canEdit={canEdit}
      />
    );
  }

  return (
    <CampaignDraftList
      drafts={drafts}
      onOpen={setOpenDraftId}
      onCreate={createDraft}
      canEdit={canEdit}
    />
  );
}
