import { and, eq, sql } from "drizzle-orm";
import type { StudioMediaDb } from "./drizzle-client";
import { mediaAssets } from "./schema/media-asset.table";
import type {
  CreateMediaAssetInput,
  MarkReadyInput,
  MediaAssetRecord,
  MediaAssetRepository,
} from "./media-asset.repository";

export class DrizzleMediaAssetRepository implements MediaAssetRepository {
  constructor(private readonly db: StudioMediaDb) {}

  async create(input: CreateMediaAssetInput): Promise<MediaAssetRecord> {
    const [row] = await this.db
      .insert(mediaAssets)
      .values({
        id: input.id,
        businessId: input.businessId,
        campaignId: input.campaignId,
        status: "uploading",
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        rawObjectKey: input.rawObjectKey,
        uploadId: input.uploadId,
        teaserStartSeconds: input.teaserStartSeconds,
      })
      .returning();
    if (row === undefined) throw new Error("insert into media_assets returned no row");
    return toDomain(row);
  }

  async findById(assetId: string): Promise<MediaAssetRecord | null> {
    const [row] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
    return row === undefined ? null : toDomain(row);
  }

  async findByIdForBusiness(assetId: string, businessId: string): Promise<MediaAssetRecord | null> {
    const [row] = await this.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.businessId, businessId)));
    return row === undefined ? null : toDomain(row);
  }

  async markQueued(assetId: string): Promise<void> {
    await this.db
      .update(mediaAssets)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(mediaAssets.id, assetId));
  }

  async setSidecarCaptions(
    assetId: string,
    url: string,
    useNow: boolean,
  ): Promise<MediaAssetRecord> {
    const [row] = await this.db
      .update(mediaAssets)
      .set({
        sidecarCaptionsUrl: url,
        ...(useNow ? { captionsUrl: url } : {}),
        updatedAt: new Date(),
      })
      .where(eq(mediaAssets.id, assetId))
      .returning();
    if (row === undefined) throw new Error(`no media_assets row for ${assetId}`);
    return toDomain(row);
  }

  async writeCampaignCaptions(campaignId: string, captionsUrl: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE campaign.campaigns SET captions_url = ${captionsUrl} WHERE id = ${campaignId}`,
    );
  }

  async markReady(assetId: string, input: MarkReadyInput): Promise<MediaAssetRecord> {
    const [row] = await this.db
      .update(mediaAssets)
      .set({
        status: "ready",
        durationSeconds: input.durationSeconds,
        aspect: input.aspect,
        posterUrl: input.posterUrl,
        teaserUrl: input.teaserUrl,
        hlsUrl: input.hlsUrl,
        captionsUrl: input.captionsUrl,
        renditionBytes: input.renditionBytes,
        updatedAt: new Date(),
      })
      .where(eq(mediaAssets.id, assetId))
      .returning();
    if (row === undefined) throw new Error(`no media_assets row for ${assetId}`);
    return toDomain(row);
  }

  async markFailed(assetId: string, failureReason: string): Promise<MediaAssetRecord> {
    const [row] = await this.db
      .update(mediaAssets)
      .set({ status: "failed", failureReason, updatedAt: new Date() })
      .where(eq(mediaAssets.id, assetId))
      .returning();
    if (row === undefined) throw new Error(`no media_assets row for ${assetId}`);
    return toDomain(row);
  }

  async writeCampaignMedia(
    campaignId: string,
    media: {
      posterUrl: string;
      teaserUrl: string;
      hlsUrl: string;
      captionsUrl: string | null;
      aspect: string;
      /** The 540p rendition: what a viewer on the default quality downloads. */
      estimatedBytes: number;
    },
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE campaign.campaigns
      SET poster_url = ${media.posterUrl},
          teaser_url = ${media.teaserUrl},
          hls_url = ${media.hlsUrl},
          captions_url = ${media.captionsUrl},
          aspect = ${media.aspect},
          estimated_bytes = ${media.estimatedBytes},
          estimated_data_mb = ${(media.estimatedBytes / (1024 * 1024)).toFixed(2)}
      WHERE id = ${campaignId}
    `);
    // The player resolves the video from here (campaignSchema's videoSource).
    await this.db.execute(sql`
      INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
      VALUES (${campaignId}, 'hls', ${media.hlsUrl})
      ON CONFLICT (campaign_id) DO UPDATE SET manifest_url = EXCLUDED.manifest_url
    `);
  }
}

function toDomain(row: typeof mediaAssets.$inferSelect): MediaAssetRecord {
  return {
    id: row.id,
    businessId: row.businessId,
    campaignId: row.campaignId,
    status: row.status,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    teaserStartSeconds: row.teaserStartSeconds,
    durationSeconds: row.durationSeconds,
    aspect: row.aspect,
    posterUrl: row.posterUrl,
    teaserUrl: row.teaserUrl,
    hlsUrl: row.hlsUrl,
    captionsUrl: row.captionsUrl,
    sidecarCaptionsUrl: row.sidecarCaptionsUrl,
    renditionBytes: row.renditionBytes,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rawObjectKey: row.rawObjectKey,
    uploadId: row.uploadId,
  };
}
