import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { POSTER_LONG_SIDE } from "./ffmpeg-transcode";
import { resolveMediaBucket } from "./hls-origin";
import { createMediaClient, putMediaOutput } from "./studio-media";

/**
 * 13.4.f: posters made before posters were card-sized are full frames of up to
 * ~95 KB. This re-encodes any stored poster over the budget, in place under the
 * same key, at the size `renderPoster` now makes. A no-op once they all fit.
 */
export const POSTER_BUDGET_BYTES = 40 * 1024;

/** The object key a public poster URL points at, if it is one of ours. */
export function posterKeyOf(url: string): string | null {
  const match = /\/(posters\/[0-9a-f-]+\.jpg)$/i.exec(url);
  return match?.[1] ?? null;
}

export async function shrinkPosters(
  keys: readonly string[],
  log: (message: string) => void,
): Promise<number> {
  const client = createMediaClient();
  const work = mkdtempSync(path.join(tmpdir(), "poster-shrink-"));
  let shrunk = 0;
  try {
    for (const key of new Set(keys)) {
      const got = await client
        .send(new GetObjectCommand({ Bucket: resolveMediaBucket(), Key: key }))
        .catch(() => null);
      if (got?.Body === undefined || (got.ContentLength ?? 0) <= POSTER_BUDGET_BYTES) continue;
      const input = path.join(work, "in.jpg");
      const output = path.join(work, "out.jpg");
      writeFileSync(input, await got.Body.transformToByteArray());
      const side = String(POSTER_LONG_SIDE);
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-vf",
        `scale='if(gt(iw,ih),${side},-2)':'if(gt(iw,ih),-2,${side})'`,
        "-q:v",
        "5",
        output,
      ]);
      await putMediaOutput(client, { kind: "poster", key, body: readFileSync(output) });
      shrunk += 1;
    }
  } finally {
    client.destroy();
    rmSync(work, { recursive: true, force: true });
  }
  if (shrunk > 0) log(`[poster-shrink] ${String(shrunk)} posters re-encoded at card size`);
  return shrunk;
}
