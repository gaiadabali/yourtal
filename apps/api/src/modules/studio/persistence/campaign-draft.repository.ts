import type { Region } from "@yourtal/contracts/region";
import type { CampaignKind, CampaignScoringRule } from "@yourtal/contracts/campaign";
import type { CampaignLifecycleState } from "@yourtal/contracts/campaign/lifecycle";
import type { CampaignChapter } from "@yourtal/contracts/campaign/chapter";
import type { Audience } from "@yourtal/contracts/campaign";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";

/**
 * Studio's own read/write model for `campaign.campaigns` (TASKS.md 7.3 --
 * "C writes the campaign and question tables; B reads them", ownership
 * table). Deliberately a DIFFERENT shape from B's viewer-facing
 * `Campaign` (`campaign/persistence/campaign.repository.ts`): this one
 * exposes the AUTHORING state (`lifecycleState`, nullable media/reward
 * fields a draft has not filled in yet) that a viewer must never see.
 */
export interface CampaignDraft {
  readonly id: string;
  readonly businessId: string;
  readonly region: Region;
  readonly kind: CampaignKind;
  readonly title: string;
  readonly synopsis: string;
  readonly durationSeconds: number;
  readonly contentCategory: ContentCategory;
  readonly audience: Audience;
  readonly lifecycleState: CampaignLifecycleState;
  readonly rejectionReason: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly openViewing: boolean;
  readonly teaserStartSeconds: number;
  readonly posterFrameSeconds: number | null;
  readonly declaredInterests: readonly string[];
  readonly chapters: readonly CampaignChapter[];
  readonly captionsUrl: string | null;
  /** Filled by 7.2's media pipeline; null until then. */
  readonly posterUrl: string | null;
  readonly teaserUrl: string | null;
  readonly hlsUrl: string | null;
  /** Filled by 7.3.c's reward endpoint; null until then. */
  readonly rewardPoints: number | null;
  readonly questionCount: number | null;
  readonly scoringRule: CampaignScoringRule | null;
  readonly publishedAt: string | null;
}

export interface CreateCampaignDraftInput {
  readonly businessId: string;
  readonly region: Region;
  readonly merchantName: string;
  readonly kind: CampaignKind;
  readonly title: string;
  readonly synopsis: string;
  readonly durationSeconds: number;
  readonly contentCategory: ContentCategory;
  readonly audience: Audience;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly openViewing: boolean;
  readonly teaserStartSeconds: number;
  readonly declaredInterests: readonly string[];
}

/**
 * A patch. Every field optional; `chapters`/`declaredInterests`, when
 * present, REPLACE the whole set (there is no per-item CRUD for either --
 * both are small, author-owned lists rewritten together, the same way a
 * form section saves).
 */
export interface UpdateCampaignDraftInput {
  // Every field explicitly `| undefined`, not just an optional key --
  // `exactOptionalPropertyTypes` (this repo's tsconfig) tells the two apart,
  // and `updateCampaignDraftSchema`'s zod-inferred type (`.optional()`
  // fields) is the explicit-union shape, not the bare-optional one.
  readonly title?: string | undefined;
  readonly synopsis?: string | undefined;
  readonly durationSeconds?: number | undefined;
  readonly contentCategory?: ContentCategory | undefined;
  readonly audience?: Audience | undefined;
  readonly startsAt?: string | undefined;
  readonly endsAt?: string | undefined;
  readonly openViewing?: boolean | undefined;
  readonly teaserStartSeconds?: number | undefined;
  readonly posterFrameSeconds?: number | null | undefined;
  readonly declaredInterests?: readonly string[] | undefined;
  readonly chapters?: readonly CampaignChapter[] | undefined;
  readonly captionsUrl?: string | null | undefined;
}

export interface CampaignDraftRepository {
  create(input: CreateCampaignDraftInput): Promise<CampaignDraft>;
  findById(businessId: string, campaignId: string): Promise<CampaignDraft | null>;
  listByBusiness(businessId: string): Promise<readonly CampaignDraft[]>;
  /**
   * TASKS.md 9.2.a: staff moderation is cross-business by nature (a
   * moderator reviews every business's queue, not one at a time), so it
   * cannot go through the businessId-scoped methods above. Never exposed to
   * a business-facing route.
   */
  findByIdAnyBusiness(campaignId: string): Promise<CampaignDraft | null>;
  /** Every campaign currently awaiting the human moderation queue (9.2.a). */
  listInReview(): Promise<readonly CampaignDraft[]>;
  update(
    businessId: string,
    campaignId: string,
    patch: UpdateCampaignDraftInput,
  ): Promise<CampaignDraft | null>;
  /**
   * TASKS.md 7.3.c: `reward_points`/`question_count`/`scoring_rule` are the
   * cheap-read mirror of the reward config `campaign.reward_config` (a
   * SEPARATE table this repository does not touch) actually owns — see
   * `20260927140000`'s own comment on why the mirror exists. This is its
   * one write path, called only from `set-reward-config.use-case.ts`.
   */
  patchRewardMirror(
    businessId: string,
    campaignId: string,
    mirror: {
      readonly rewardPoints: number;
      readonly questionCount: number;
      readonly scoringRule: CampaignScoringRule;
    },
  ): Promise<CampaignDraft | null>;

  /**
   * The one write path for `lifecycle_state`. Relies on
   * `campaign.assert_lifecycle_transition()` (20260927140000, EW-17) to
   * refuse an illegal move at the database -- this method surfaces that as
   * a typed refusal rather than letting a raw constraint-violation escape.
   */
  transitionLifecycle(
    businessId: string,
    campaignId: string,
    to: CampaignLifecycleState,
    /**
     * 9.2.a: staff rejection records why, in the same write as the
     * transition (never a second round trip). `undefined` leaves the
     * column untouched -- every pre-existing caller (draft -> in_review,
     * pause/resume) passes nothing and behaves exactly as before.
     */
    rejectionReason?: string,
  ): Promise<{ readonly ok: true; readonly draft: CampaignDraft } | { readonly ok: false }>;
}

export const CAMPAIGN_DRAFT_REPOSITORY = Symbol("CAMPAIGN_DRAFT_REPOSITORY");
