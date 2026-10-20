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
  posterVariantKey,
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

/**
 * 14.6.b: posters made before responsive sizes exist have only the 640. This
 * writes the missing sizes beside each one, from the stored image (a larger size
 * is an enlargement: no sharper, but the set is complete and the browser never
 * asks for a file that is not there). Skips a poster whose sizes all exist, so a
 * second run writes nothing. Returns how many posters it filled in.
 */
export async function ensurePosterLadder(
  baseKeys: readonly string[],
  log: (message: string) => void,
  store?: PosterStore,
): Promise<number> {
  const client = store === undefined ? createMediaClient() : null;
  const posters = store ?? s3PosterStore(client as S3Client);
  const work = mkdtempSync(path.join(tmpdir(), "poster-ladder-"));
  let filled = 0;
  try {
    for (const baseKey of new Set(baseKeys)) {
      const missing: { longSide: (typeof POSTER_LONG_SIDES)[number]; key: string }[] = [];
      for (const longSide of POSTER_LONG_SIDES) {
        if (longSide === POSTER_LONG_SIDE) continue;
        const key = posterVariantKey(baseKey, longSide);
        if (key !== null && !(await posters.has(key))) missing.push({ longSide, key });
      }
      if (missing.length === 0) continue;
      const base = await posters.get(baseKey);
      if (base === null) continue;
      const input = path.join(work, "in.jpg");
      writeFileSync(input, base);
      for (const { longSide, key } of missing) {
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
      filled += 1;
    }
  } finally {
    client?.destroy();
    rmSync(work, { recursive: true, force: true });
  }
  if (filled > 0) log(`[poster-ladder] ${String(filled)} posters given their other sizes`);
  return filled;
}
