import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { CampaignChapter } from "@yourtal/contracts/campaign/chapter";
import type { CampaignLifecycleState } from "@yourtal/contracts/campaign/lifecycle";
import { campaignChapters, campaigns } from "../../campaign/persistence/schema/campaign.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type {
  CampaignDraft,
  CampaignDraftRepository,
  CreateCampaignDraftInput,
  UpdateCampaignDraftInput,
} from "./campaign-draft.repository";

/**
 * Verified against a live Postgres (YT-0552 discipline, matching the
 * business module's own repositories). Writes `campaign.campaigns` and
 * `campaign.chapter` -- the tables 7.1's own migrations already granted
 * `yourtal_app` full CRUD on (`campaign/persistence/schema/**` is this
 * area's, per TASKS.md's ownership table); B's viewer-facing
 * `DrizzleCampaignRepository` reads the same tables through its own,
 * differently-shaped assembler.
 */
export class DrizzleCampaignDraftRepository implements CampaignDraftRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: CreateCampaignDraftInput): Promise<CampaignDraft> {
    const [row] = await this.db
      .insert(campaigns)
      .values({
        id: randomUUID(),
        kind: input.kind,
        title: input.title,
        merchantId: input.businessId,
        merchantName: input.merchantName,
        synopsis: input.synopsis,
        durationSeconds: input.durationSeconds,
        lifecycleState: "draft",
        businessId: input.businessId,
        region: input.region,
        audience: input.audience,
        contentCategory: input.contentCategory,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        openViewing: input.openViewing,
        teaserStartSeconds: input.teaserStartSeconds,
        declaredInterests: input.declaredInterests,
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into campaign.campaigns returned no row");
    }
    return toDomain(row, []);
  }

  async findById(businessId: string, campaignId: string): Promise<CampaignDraft | null> {
    const [row] = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)))
      .limit(1);
    if (row === undefined) return null;
    const chapters = await this.chaptersFor(campaignId);
    return toDomain(row, chapters);
  }

  async listByBusiness(businessId: string): Promise<readonly CampaignDraft[]> {
    const rows = await this.db.select().from(campaigns).where(eq(campaigns.businessId, businessId));
    return Promise.all(rows.map(async (row) => toDomain(row, await this.chaptersFor(row.id))));
  }

  async update(
    businessId: string,
    campaignId: string,
    patch: UpdateCampaignDraftInput,
  ): Promise<CampaignDraft | null> {
    const { chapters: newChapters, ...columnPatch } = patch;
    const values: Record<string, unknown> = {};
    if (columnPatch.title !== undefined) values["title"] = columnPatch.title;
    if (columnPatch.synopsis !== undefined) values["synopsis"] = columnPatch.synopsis;
    if (columnPatch.durationSeconds !== undefined) {
      values["durationSeconds"] = columnPatch.durationSeconds;
    }
    if (columnPatch.contentCategory !== undefined) {
      values["contentCategory"] = columnPatch.contentCategory;
    }
    if (columnPatch.audience !== undefined) values["audience"] = columnPatch.audience;
    if (columnPatch.startsAt !== undefined) values["startsAt"] = new Date(columnPatch.startsAt);
    if (columnPatch.endsAt !== undefined) values["endsAt"] = new Date(columnPatch.endsAt);
    if (columnPatch.openViewing !== undefined) values["openViewing"] = columnPatch.openViewing;
    if (columnPatch.teaserStartSeconds !== undefined) {
      values["teaserStartSeconds"] = columnPatch.teaserStartSeconds;
    }
    if (columnPatch.posterFrameSeconds !== undefined) {
      values["posterFrameSeconds"] = columnPatch.posterFrameSeconds;
    }
    if (columnPatch.declaredInterests !== undefined) {
      values["declaredInterests"] = columnPatch.declaredInterests;
    }
    if (columnPatch.captionsUrl !== undefined) values["captionsUrl"] = columnPatch.captionsUrl;

    if (Object.keys(values).length > 0) {
      const updated = await this.db
        .update(campaigns)
        .set(values)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)))
        .returning();
      if (updated[0] === undefined) return null;
    }

    if (newChapters !== undefined) {
      await this.replaceChapters(campaignId, newChapters);
    }

    return this.findById(businessId, campaignId);
  }

  async patchRewardMirror(
    businessId: string,
    campaignId: string,
    mirror: {
      readonly rewardPoints: number;
      readonly questionCount: number;
      readonly scoringRule: string;
    },
  ): Promise<CampaignDraft | null> {
    const [row] = await this.db
      .update(campaigns)
      .set({
        rewardPoints: mirror.rewardPoints,
        questionCount: mirror.questionCount,
        scoringRule: mirror.scoringRule,
      })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)))
      .returning();
    if (row === undefined) return null;
    const chapters = await this.chaptersFor(campaignId);
    return toDomain(row, chapters);
  }

  async transitionLifecycle(
    businessId: string,
    campaignId: string,
    to: CampaignLifecycleState,
  ): Promise<{ readonly ok: true; readonly draft: CampaignDraft } | { readonly ok: false }> {
    try {
      const [row] = await this.db
        .update(campaigns)
        .set({ lifecycleState: to })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)))
        .returning();
      if (row === undefined) return { ok: false };
      const chapters = await this.chaptersFor(campaignId);
      return { ok: true, draft: toDomain(row, chapters) };
    } catch {
      // The database refused (campaigns_lifecycle_transition, or one of the
      // "required past draft" CHECKs) -- both read as the same refusal to
      // this method's own caller, which already knows WHY it is refusing
      // via its own pre-checks (canTransition, KYB) and asks this only to
      // perform a move it already believes is legal.
      return { ok: false };
    }
  }

  private async chaptersFor(campaignId: string): Promise<CampaignChapter[]> {
    const rows = await this.db
      .select()
      .from(campaignChapters)
      .where(eq(campaignChapters.campaignId, campaignId))
      .orderBy(asc(campaignChapters.ordinal));
    return rows.map((row) => ({
      title: row.title,
      startSeconds: row.startSeconds,
      rewardWeight: Number(row.rewardWeight),
    }));
  }

  private async replaceChapters(
    campaignId: string,
    chapters: readonly CampaignChapter[],
  ): Promise<void> {
    await this.db.delete(campaignChapters).where(eq(campaignChapters.campaignId, campaignId));
    if (chapters.length === 0) return;
    await this.db.insert(campaignChapters).values(
      chapters.map((chapter, index) => ({
        campaignId,
        ordinal: index,
        title: chapter.title,
        startSeconds: chapter.startSeconds,
        rewardWeight: chapter.rewardWeight.toString(),
      })),
    );
  }
}

function toDomain(
  row: typeof campaigns.$inferSelect,
  chapters: readonly CampaignChapter[],
): CampaignDraft {
  return {
    id: row.id,
    businessId: row.businessId,
    region: row.region as CampaignDraft["region"],
    kind: row.kind as CampaignDraft["kind"],
    title: row.title,
    synopsis: row.synopsis,
    durationSeconds: row.durationSeconds,
    contentCategory: row.contentCategory as CampaignDraft["contentCategory"],
    audience: row.audience as CampaignDraft["audience"],
    lifecycleState: row.lifecycleState as CampaignLifecycleState,
    rejectionReason: row.rejectionReason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    openViewing: row.openViewing,
    teaserStartSeconds: row.teaserStartSeconds,
    posterFrameSeconds: row.posterFrameSeconds,
    declaredInterests: (row.declaredInterests as string[] | null) ?? [],
    chapters,
    captionsUrl: row.captionsUrl,
    posterUrl: row.posterUrl,
    teaserUrl: row.teaserUrl,
    hlsUrl: row.hlsUrl,
    rewardPoints: row.rewardPoints,
    questionCount: row.questionCount,
    scoringRule: row.scoringRule as CampaignDraft["scoringRule"],
    publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
  };
}
