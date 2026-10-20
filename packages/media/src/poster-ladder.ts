import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { posterScaleFilter } from "./ffmpeg-transcode";
import { resolveMediaBucket } from "./hls-origin";
import {
  POSTER_JPEG_QUALITY,
  POSTER_LONG_SIDE,
  POSTER_LONG_SIDES,
  posterKeyOf,
  posterVariantKey,
  posterVariantsFor,
  type PosterAspect,
  type PosterLongSide,
  type PosterVariant,
} from "./poster-variants";
import { createMediaClient, putMediaOutput } from "./studio-media";

/** Where posters live. Injected so the backfill can be tested without an object store. */
export interface PosterStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array): Promise<void>;
}

export function s3PosterStore(client: S3Client): PosterStore {
  const Bucket = resolveMediaBucket();
  return {
    has: (Key) =>
      client.send(new HeadObjectCommand({ Bucket, Key })).then(
        () => true,
        () => false,
      ),
    get: async (Key) => {
      const got = await client.send(new GetObjectCommand({ Bucket, Key })).catch(() => null);
      return got?.Body === undefined ? null : got.Body.transformToByteArray();
    },
    put: (Key, body) => putMediaOutput(client, { kind: "poster", key: Key, body }),
  };
}

/** A campaign whose poster has no recorded sizes yet. */
export interface PosterRow {
  readonly id: string;
  readonly posterUrl: string;
  readonly aspect: PosterAspect;
}

/** Where recorded sizes live: `campaign.campaigns.poster_variants`. Injected for tests. */
export interface PosterRecorder {
  /** Rows with a poster and an empty `poster_variants`. */
  pending(): Promise<PosterRow[]>;
  record(id: string, variants: readonly PosterVariant[]): Promise<void>;
}

/** The minimal slice of `pg.Pool` this needs. */
interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export function pgPosterRecorder(pool: Queryable): PosterRecorder {
  return {
    pending: async () => {
      const { rows } = await pool.query(
        `SELECT id, poster_url, aspect FROM campaign.campaigns
          WHERE poster_url IS NOT NULL AND poster_variants = '[]'::jsonb
            AND aspect IN ('16:9', '9:16')`,
      );
      return (rows as { id: string; poster_url: string; aspect: PosterAspect }[]).map((row) => ({
        id: row.id,
        posterUrl: row.poster_url,
        aspect: row.aspect,
      }));
    },
    record: async (id, variants) => {
      await pool.query("UPDATE campaign.campaigns SET poster_variants = $2::jsonb WHERE id = $1", [
        id,
        JSON.stringify(variants),
      ]);
    },
  };
}

/**
 * 14.6.b: posters made before responsive sizes exist have only the 640. For each
 * campaign with no recorded sizes this writes the smaller sizes beside its poster
 * (never a larger one: a 960 made from a 640 is no sharper, only heavier), then
 * records the sizes that exist, so a `srcset` never names a file that is missing.
 * A poster whose file cannot be read is left alone. Re-running does nothing for a
 * campaign that already has its sizes recorded. Returns how many campaigns it
 * recorded.
 */
export async function ensurePosterLadder(
  recorder: PosterRecorder,
  log: (message: string) => void,
  store?: PosterStore,
): Promise<number> {
  const rows = await recorder.pending();
  if (rows.length === 0) return 0;
  const client = store === undefined ? createMediaClient() : null;
  const posters = store ?? s3PosterStore(client as S3Client);
  const work = mkdtempSync(path.join(tmpdir(), "poster-ladder-"));
  const byUrl = new Map<string, PosterRow[]>();
  for (const row of rows) byUrl.set(row.posterUrl, [...(byUrl.get(row.posterUrl) ?? []), row]);
  let recorded = 0;
  try {
    for (const [posterUrl, group] of byUrl) {
      const baseKey = posterKeyOf(posterUrl);
      if (baseKey === null || posterVariantKey(baseKey, 320) === null) continue;
      const base = await posters.get(baseKey);
      if (base === null) continue;
      const input = path.join(work, "in.jpg");
      writeFileSync(input, base);
      const stored: PosterLongSide[] = [POSTER_LONG_SIDE];
      for (const longSide of POSTER_LONG_SIDES) {
        if (longSide === POSTER_LONG_SIDE) continue;
        const key = posterVariantKey(baseKey, longSide);
        if (key === null) continue;
        if (!(await posters.has(key))) {
          if (longSide > POSTER_LONG_SIDE) continue;
          const output = path.join(work, `out-${String(longSide)}.jpg`);
          execFileSync("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            input,
            "-vf",
            posterScaleFilter(longSide),
            "-q:v",
            String(POSTER_JPEG_QUALITY[longSide]),
            output,
          ]);
          await posters.put(key, readFileSync(output));
        }
        stored.push(longSide);
      }
      for (const row of group) {
        await recorder.record(row.id, posterVariantsFor(posterUrl, row.aspect, stored));
      }
      recorded += group.length;
    }
  } finally {
    client?.destroy();
    rmSync(work, { recursive: true, force: true });
  }
  if (recorded > 0) log(`[poster-ladder] ${String(recorded)} campaigns given their poster sizes`);
  return recorded;
}
