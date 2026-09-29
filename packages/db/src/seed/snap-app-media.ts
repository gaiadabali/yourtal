import type pg from "pg";
import { publicMediaUrl } from "@yourtal/media/hls-origin";

/** The Snap App quick campaigns' own clip: 30 s of the Big Buck Bunny trailer (CC-BY 3.0). */
export const SNAP_APP_ASSET_ID = "snap-app-30s";

/**
 * The Snap App quick campaigns were seeded on the `attention-30s` colour-bar
 * test card, with loopback poster and teaser URLs that never existed on
 * staging. Once `snap-app-30s` is published, point them at it. Runs every
 * deploy; a no-op once repointed.
 */
export async function repairSnapAppMedia(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<{ repointed: number }> {
  const posterUrl = publicMediaUrl(`posters/${SNAP_APP_ASSET_ID}.jpg`);
  const teaserUrl = publicMediaUrl(`teasers/${SNAP_APP_ASSET_ID}.mp4`);
  const hlsUrl = publicMediaUrl(`hls/${SNAP_APP_ASSET_ID}/index.m3u8`);
  const campaigns = await pool.query<{ id: string }>(
    `UPDATE campaign.campaigns
        SET poster_url = $1, teaser_url = $2, hls_url = $3
      WHERE merchant_name = 'Snap App' AND hls_url LIKE '%/hls/attention-30s/%'
      RETURNING id`,
    [posterUrl, teaserUrl, hlsUrl],
  );
  const ids = campaigns.rows.map((row) => row.id);
  if (ids.length > 0) {
    await pool.query(
      `UPDATE campaign.video_source SET manifest_url = $2 WHERE campaign_id = ANY($1::uuid[])`,
      [ids, hlsUrl],
    );
    log(
      `[seed:snap-app-media] ${String(ids.length)} Snap App campaigns now play ${SNAP_APP_ASSET_ID}`,
    );
  }
  return { repointed: ids.length };
}
