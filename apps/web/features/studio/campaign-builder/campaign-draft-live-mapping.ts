import type { z } from "zod";
import type { audienceSchema, campaignKindSchema } from "@yourtal/contracts/campaign";
import type { ApiCampaignDraft, ApiRewardConfigResult } from "./campaign-draft-live-response";
import {
  apiCampaignDraftSchema,
  apiRewardConfigResultSchema,
} from "./campaign-draft-live-response";
import type { CampaignDraft } from "./campaign-draft";
import type { CampaignDraftStatus } from "./campaign-draft-status";

/**
 * The bridge between 7.3's real `apps/api` campaign-authoring shape
 * (`apiCampaignDraftSchema`, restated here rather than imported from
 * `apps/api` — a server can't import another app) and this feature's own
 * authoring-time `CampaignDraft` (`campaign-draft.ts`), which predates 7.3
 * and was built against Phase U's mock fixtures.
 *
 * The two shapes genuinely diverge in a few places that this pass does NOT
 * reconcile — each is called out at its own field below rather than
 * silently dropped:
 *   - `targeting.districts` and `budget` have no live equivalent yet (no
 *     endpoint stores them) — they stay locally-held, mock-only fields
 *     until a real one exists.
 *   - `chapters`: the real contract's `CampaignChapter` is
 *     `{title, startSeconds, rewardWeight}` (a back-loaded reward CURVE);
 *     this feature's own `{id, title, startSeconds}` predates that and has
 *     no reward-weight field of its own. Round-tripped here with a
 *     synthetic display `id` and a flat `rewardWeight: 1` — accurate for
 *     "same reward every chapter" but loses a real, unequal weighting if
 *     the server ever returns one. Reconciling the two shapes for real is
 *     this ticket's own next slice, not invented here.
 *   - `rewardPoints`/`scoringRule` ARE round-tripped (the draft row's own
 *     "mirror" fields, kept in sync by `PUT .../reward`'s use-case), but
 *     `allocationId`/`accuracyBonusPoints`/the server's priced
 *     `rewardValueMinorUnits` are NOT — `GET`/list never returns them (only
 *     a successful `PUT .../reward` response does, per
 *     `SetRewardConfigResult`). So they read back `null`/`0` on every fresh
 *     load (mock or a live page reload) — the honest "not set THIS
 *     session" state, not a fabricated zero. See
 *     `campaign-builder-actions.ts`'s `setRewardConfigLive`.
 *   - `questionBank`: the real question bank lives at its own endpoint
 *     (`GET .../questions`), not embedded in the draft response — left `[]`
 *     here; `campaign-builder-screen.tsx`'s `openDraft` fetches it
 *     separately when live, the same reason `team-data.ts` fetches Team's
 *     roster separately from the cheap per-zone membership read.
 */

const CAMPAIGN_DRAFT_STATUS_SET = new Set<CampaignDraftStatus>([
  "draft",
  "in_review",
  "live",
  "paused",
  "rejected",
]);

/** The real lifecycle has one more terminal state (`ended`) than this feature's own `CampaignDraftStatus` models yet — shown as `paused` (also non-editable, also not "still running") rather than crashing on an unrecognised value. */
function toDraftStatus(lifecycleState: string): CampaignDraftStatus {
  return CAMPAIGN_DRAFT_STATUS_SET.has(lifecycleState as CampaignDraftStatus)
    ? (lifecycleState as CampaignDraftStatus)
    : "paused";
}

export function apiDraftToWebDraft(api: ApiCampaignDraft, merchantName: string): CampaignDraft {
  return {
    id: api.id,
    businessId: api.businessId,
    title: api.title,
    synopsis: api.synopsis,
    merchantName,
    kind: api.kind,
    video: {
      fileName: null,
      // A real, ready HLS render is the one signal available from the
      // draft row itself; anything still in flight from `media.e2e`'s own
      // asset-status polling is only known to the specific upload session
      // that started it, not to a fresh page load — see
      // `campaign-editor-upload.tsx`'s own real-upload path for that part.
      status: api.hlsUrl ? "ready" : "idle",
      progressPercent: api.hlsUrl ? 100 : 0,
      assetId: null,
      failureReason: null,
    },
    chapters: api.chapters.map((chapter, index) => ({
      id: `${api.id}-chapter-${index}`,
      title: chapter.title,
      startSeconds: chapter.startSeconds,
    })),
    rewardPoints: api.rewardPoints ?? 0,
    scoringRule: api.scoringRule ?? "base_only",
    targeting: { interests: [...api.declaredInterests], districts: [] },
    budget: { totalBudgetPoints: 0, dailyCapPoints: null },
    questionBank: [],
    status: toDraftStatus(api.lifecycleState),
    rejectionReason: api.rejectionReason,
    updatedAt: api.publishedAt ?? new Date(0).toISOString(),
    contentCategory: api.contentCategory,
    audience: api.audience,
    startsAt: api.startsAt,
    endsAt: api.endsAt,
    openViewing: api.openViewing,
    teaserStartSeconds: api.teaserStartSeconds,
    captionsUrl: api.captionsUrl,
    allocationId: null,
    accuracyBonusPoints: 0,
    rewardValueMinorUnits: null,
    rewardCurrency: null,
  };
}

/** A safe, always-valid starting point for `POST .../studio/campaigns` (7.3.a) — this editor still has no CREATE-TIME intake form for the fields the endpoint requires up front (category/audience/schedule); the author edits them immediately afterward in the Details tab instead, through the real `PATCH`. */
export interface NewCampaignDraftDefaults {
  readonly kind: z.infer<typeof campaignKindSchema>;
  readonly title: string;
  readonly synopsis: string;
  readonly durationSeconds: number;
  readonly contentCategory: string;
  readonly audience: z.infer<typeof audienceSchema>;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly openViewing: boolean;
  readonly teaserStartSeconds: number;
  readonly declaredInterests: readonly string[];
}

export function newCampaignDraftDefaults(): NewCampaignDraftDefaults {
  const now = new Date();
  const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    kind: "long_form",
    title: "Untitled campaign",
    synopsis: "Add a synopsis before you submit for review.",
    // A minute — a plausible placeholder until the real video upload
    // (already wired, `media-upload-client.ts`) tells the campaign how
    // long it actually is.
    durationSeconds: 60,
    // `all_ages`/a neutral, non-regulated category: the safest default this
    // ticket can pick without a category/audience field in the editor yet
    // to ask the author directly (F8/red-line-adjacent — never default
    // INTO a regulated category or a narrower audience than "all_ages").
    contentCategory: "entertainment",
    audience: "all_ages",
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    openViewing: false,
    teaserStartSeconds: 0,
    declaredInterests: [],
  };
}

/** `allocationId`/`accuracyBonusPoints` come from the caller's own form, not the response — `SetRewardConfigResult` doesn't carry them back (see this file's own doc comment). */
export function apiRewardResultToWebDraft(
  api: ApiRewardConfigResult,
  merchantName: string,
  allocationId: string,
  accuracyBonusPoints: number,
): CampaignDraft {
  return {
    ...apiDraftToWebDraft(api, merchantName),
    allocationId,
    accuracyBonusPoints,
    rewardValueMinorUnits: api.rewardValueMinor,
    rewardCurrency: api.currency,
  };
}

export { apiCampaignDraftSchema, apiRewardConfigResultSchema };
