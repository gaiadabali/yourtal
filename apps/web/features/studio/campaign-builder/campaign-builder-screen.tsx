"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import type { CampaignDraft } from "./campaign-draft";
import { CampaignDraftList } from "./campaign-draft-list";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import {
  createCampaignDraftLive,
  updateCampaignDraftDetailsLive,
} from "./campaign-builder-actions";
import { detailsPatchFor, detailsSaveKey } from "./campaign-details-save";
import type { DetailsSaveState } from "./campaign-save-bar";
import { listQuestionsLive } from "../question-bank/question-live-actions";
import { isDraftContentEditable } from "./campaign-draft-status";
import dynamic from "next/dynamic";
import { Skeleton } from "@yourtal/ui/skeleton";

// The editor (form, reward-risk, upload, preview) only renders once a draft is
// opened, so it loads then instead of in the list's initial JS. It kept
// /business/campaigns over its 200 KB budget (2.4.h, F38).
const CampaignEditor = dynamic(
  () => import("./campaign-editor").then((editorModule) => editorModule.CampaignEditor),
  { loading: () => <Skeleton className="h-96 w-full rounded-lg" /> },
);

/** How long after the last edit the details and targeting save themselves. */
export const AUTOSAVE_DELAY_MS = 1_000;

export interface CampaignBuilderScreenProps {
  businessId: string;
  merchantName: string;
  initialDrafts: CampaignDraft[];
  canEdit: boolean;
  /** Whether the business has passed KYB review — gates the "Submit for review" action (7.3.d, red line 7). */
  isVerified: boolean;
  /** `YOURTAL_DATA_SOURCE === "live"` — threaded down to every leaf that needs to pick between a real call and the mock simulation. */
  isLiveMode: boolean;
  /** The partner allocations a reward may draw from (`GET .../studio/campaign-funding`, 13.3.b). */
  allocations: BillingAllocation[];
}

/**
 * The Campaigns zone (YT-0441): the campaign list and, once one is opened,
 * its full builder — the one client leaf for this whole zone, mirroring
 * `features/studio/team-screen.tsx`'s "one leaf owns the whole flow"
 * shape. Every edit lives in this component's own `useState` array; in live
 * mode the details and targeting are saved from here (see `saveDetails`), the
 * reward, budget and questions from their own tabs.
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
  const t = useTranslations("studio");
  const [drafts, setDrafts] = useState<CampaignDraft[]>(initialDrafts);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  /** The details as the server holds them, as a `detailsSaveKey`; what the screen compares the draft against to know it is not saved. */
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ key: string; message: string } | null>(null);

  // The latest of each, for the saves below, which run on timers and after awaits and so
  // must not read the render they were made in.
  const latest = useRef({ drafts, openDraftId, savedKey });
  useEffect(() => {
    latest.current = { drafts, openDraftId, savedKey };
  });
  const inFlight = useRef<Promise<string | null> | null>(null);

  const patchDraft = useCallback((draftId: string, patch: Partial<CampaignDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft)),
    );
  }, []);

  function updateDraft(next: CampaignDraft) {
    setDrafts((current) => current.map((draft) => (draft.id === next.id ? next : draft)));
  }

  /** What the server holds for a draft this screen has just loaded or created. */
  function markSaved(draft: CampaignDraft) {
    latest.current.savedKey = detailsSaveKey(draft);
    setSavedKey(detailsSaveKey(draft));
    setSaveError(null);
  }

  async function createDraft() {
    if (isLiveMode) {
      const result = await createCampaignDraftLive(businessId, merchantName, {
        title: t("campaignBuilder.newDraft.title"),
        // Left empty: the editor shows its hint as a placeholder, never as the text itself.
        synopsis: "",
      });
      if (!result.ok) {
        setCreateError(result.message);
        return;
      }
      setCreateError(null);
      setDrafts((current) => [result.value, ...current]);
      markSaved(result.value);
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
    const opened = drafts.find((draft) => draft.id === draftId);
    if (isLiveMode) {
      const result = await listQuestionsLive(businessId, draftId);
      if (result.ok) patchDraft(draftId, { questionBank: result.value });
      if (opened) markSaved(opened);
    }
    setOpenDraftId(draftId);
  }

  /**
   * Saves the details and targeting (one `PATCH`) when they differ from what the server
   * holds; the error message, or null once saved (or when there was nothing to save, or in
   * mock mode). It runs a moment after the last edit, on leaving a tab, on Submit, on the
   * Save button and on leaving the editor, so an edit is never left waiting on one
   * particular gesture. One save at a time: a second call waits for the first, then
   * saves whatever changed since. Reward, budget and questions save from their own tabs
   * (the author needs the server's refusal, or the priced value, right there).
   */
  const saveDetails = useCallback(async (): Promise<string | null> => {
    while (inFlight.current) await inFlight.current;
    const { drafts: all, openDraftId: openId, savedKey: held } = latest.current;
    const current = all.find((draft) => draft.id === openId);
    if (!isLiveMode || !current) return null;
    const patch = detailsPatchFor(current);
    const key = detailsSaveKey(current);
    if (patch === null) {
      const message = t("campaignBuilder.save.needsTitle");
      setSaveError({ key, message });
      return message;
    }
    if (key === held) return null;

    const run = (async (): Promise<string | null> => {
      setSaving(true);
      const result = await updateCampaignDraftDetailsLive(
        businessId,
        current.id,
        merchantName,
        patch,
      ).catch(() => null);
      setSaving(false);
      if (result === null) {
        const message = t("campaignBuilder.save.failed");
        setSaveError({ key, message });
        return message;
      }
      if (!result.ok) {
        setSaveError({ key, message: result.message });
        return result.message;
      }
      // Only what the server alone knows comes back. The PATCH response has no question
      // bank, and its video, reward and everything typed since are not its to overwrite.
      patchDraft(current.id, {
        durationSeconds: result.value.durationSeconds,
        questionsAsked: result.value.questionsAsked,
      });
      latest.current.savedKey = key;
      setSavedKey(key);
      setSaveError(null);
      return null;
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [businessId, isLiveMode, merchantName, patchDraft, t]);

  const openDraftValue = drafts.find((draft) => draft.id === openDraftId);
  const editable =
    canEdit && openDraftValue !== undefined && isDraftContentEditable(openDraftValue.status);
  const currentKey = openDraftValue ? detailsSaveKey(openDraftValue) : null;
  const dirty = isLiveMode && editable && currentKey !== null && currentKey !== savedKey;

  // Autosave: a moment after the last edit. An error is not retried by itself (the same
  // edit would be refused the same way); the next edit, or the Save button, tries again.
  const failedKey = saveError?.key ?? null;
  useEffect(() => {
    if (!dirty || currentKey === failedKey) return;
    const timer = setTimeout(() => void saveDetails(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, currentKey, failedKey, saveDetails]);

  // Leaving the page (a reload, a close, another link) with edits waiting asks first, and
  // leaving by a link inside the app saves them as the editor goes away.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const flushOnUnmount = useRef(saveDetails);
  useEffect(() => {
    flushOnUnmount.current = saveDetails;
  }, [saveDetails]);
  useEffect(() => () => void flushOnUnmount.current(), []);

  async function closeEditor() {
    // A save hiccup on the way out is not worth trapping the author in the
    // editor over — the list's own next live fetch shows what the server holds.
    await saveDetails();
    setOpenDraftId(null);
  }

  const detailsSave: DetailsSaveState = saving
    ? { status: "saving" }
    : saveError !== null && saveError.key === currentKey
      ? { status: "error", message: saveError.message }
      : dirty
        ? { status: "dirty" }
        : { status: "saved" };

  if (openDraftValue) {
    return (
      <CampaignEditor
        draft={openDraftValue}
        onChange={updateDraft}
        onPatch={(patch) => patchDraft(openDraftValue.id, patch)}
        onBack={() => void closeEditor()}
        onSave={saveDetails}
        detailsSave={detailsSave}
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
