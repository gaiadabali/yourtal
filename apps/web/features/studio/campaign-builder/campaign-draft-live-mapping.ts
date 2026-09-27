import type { z } from "zod";
import type { audienceSchema, campaignKindSchema } from "@yourtal/contracts/campaign";
import type { ApiCampaignDraft } from "./campaign-draft-live-response";
import { apiCampaignDraftSchema } from "./campaign-draft-live-response";
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
 *   - `rewardPoints`/`scoringRule`: real reward config is base + a
 *     separate accuracy bonus (`campaignRewardConfigSchema`); this
 *     feature's `rewardPoints` is one flat number. Read-mapped as
 *     `rewardPoints ?? 0` and NOT yet written back through the real
 *     `PUT .../reward` endpoint (see `campaign-builder-data.ts`'s own doc
 *     comment on why reward/questions stay mock-only this pass).
 *   - `questionBank`: the real question bank lives at its own endpoint
 *     (`GET .../questions`), not embedded in the draft response — left `[]`
 *     here; wiring it is the same next slice as reward config.
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
  };
}

/** A safe, always-valid starting point for `POST .../studio/campaigns` (7.3.a) — every field the create endpoint requires that this feature's "New campaign" button collects none of yet. The author edits title/synopsis immediately afterward; the rest (category/audience/schedule) becomes a real field in the editor's own next slice. */
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

export { apiCampaignDraftSchema };
