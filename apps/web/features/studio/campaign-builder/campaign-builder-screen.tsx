"use client";

import { useState } from "react";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { draftDurationSeconds } from "./campaign-draft";
import type { CampaignDraft } from "./campaign-draft";
import { CampaignDraftList } from "./campaign-draft-list";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import {
  createCampaignDraftLive,
  updateCampaignDraftDetailsLive,
} from "./campaign-builder-actions";
import { listQuestionsLive } from "../question-bank/question-live-actions";
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
  /** `YOURTAL_DATA_SOURCE === "live"` — threaded down to every leaf that needs to pick between a real call and the mock simulation. */
  isLiveMode: boolean;
  /** The business's own funded point allocations (`GET .../billing/balance`, live only) — a reward config names one of these (7.3.c). Empty in mock mode. */
  allocations: BillingAllocation[];
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
  allocations,
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
   * Fetches the real question bank once, opening a draft live — the same
   * reason `team-data.ts` fetches Team's roster separately from the cheap
   * per-zone read: the list endpoint (`campaign-builder-data.ts`) never
   * embeds it.
   */
  async function openDraft(draftId: string) {
    if (isLiveMode) {
      const result = await listQuestionsLive(businessId, draftId);
      if (result.ok) {
        setDrafts((current) =>
          current.map((draft) =>
            draft.id === draftId ? { ...draft, questionBank: result.value } : draft,
          ),
        );
      }
    }
    setOpenDraftId(draftId);
  }

  /**
   * Flushes the details tab's fields to the real draft on the way out of
   * the editor, rather than on every keystroke (`@NotValueMoving`, so a
   * repeat is harmless, but a PATCH per character is still wasted work).
   * Reward and questions save immediately from their own tabs instead (the
   * author needs to see the server's refusal/priced value, or the PII
   * guard's refusal, right there — see `campaign-editor-reward.tsx` and
   * `question-bank-screen.tsx`). `targeting.districts`/`budget` have no
   * live field in the real DTO at all (TASKS.md 7.8.b's note) and stay
   * local-only.
   */
  async function closeEditor() {
    const current = drafts.find((draft) => draft.id === openDraftId);
    if (isLiveMode && current) {
      const computedDuration = draftDurationSeconds(current);
      const result = await updateCampaignDraftDetailsLive(businessId, current.id, merchantName, {
        title: current.title,
        synopsis: current.synopsis,
        // Only send a duration once local chapters actually imply one — an
        // empty chapter list computes to 0, which would otherwise overwrite
        // the server's real, already-known duration (from creation or a
        // real video upload) with a bogus tiny value.
        ...(computedDuration > 0 ? { durationSeconds: computedDuration } : {}),
        contentCategory: current.contentCategory,
        audience: current.audience,
        startsAt: current.startsAt,
        endsAt: current.endsAt,
        openViewing: current.openViewing,
        teaserStartSeconds: current.teaserStartSeconds,
        captionsUrl: current.captionsUrl,
      });
      if (result.ok) {
        // The PATCH response has no question bank of its own (see
        // campaign-builder-data.ts) — keep the one already fetched into
        // local state rather than overwrite it with the mapper's `[]`.
        updateDraft({ ...result.value, questionBank: current.questionBank });
      }
      // A save hiccup on the way out is not worth trapping the author in
      // the editor over — the list's own next live fetch shows whatever
      // the server actually holds either way.
    }
    setOpenDraftId(null);
  }

  const openDraftValue = drafts.find((draft) => draft.id === openDraftId);

  if (openDraftValue) {
    return (
      <CampaignEditor
        draft={openDraftValue}
        onChange={updateDraft}
        onBack={() => void closeEditor()}
        canEdit={canEdit}
        isVerified={isVerified}
        isLiveMode={isLiveMode}
        allocations={allocations}
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
        onOpen={(draftId) => void openDraft(draftId)}
        onCreate={() => void createDraft()}
        canEdit={canEdit}
      />
    </div>
  );
}
