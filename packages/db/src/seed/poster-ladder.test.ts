import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePosterLadder, pgPosterRecorder } from "@yourtal/media/poster-ladder";
import type { PosterStore } from "@yourtal/media/poster-ladder";
import { OWNER_URL } from "../database-urls";

/**
 * 14.6.b: the staging backfill against the real `campaign.campaigns.poster_variants`
 * column, with an in-memory object store (the S3 side is covered in the media package).
 */
let owner: pg.Pool;
let workDir: string;
const created: string[] = [];

beforeAll(() => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
  workDir = mkdtempSync(path.join(tmpdir(), "yt-poster-db-"));
});

afterAll(async () => {
  for (const id of created) await owner.query("DELETE FROM campaign.campaigns WHERE id = $1", [id]);
  await owner.end();
  rmSync(workDir, { recursive: true, force: true });
});

function jpeg(): Uint8Array {
  const file = path.join(workDir, "base.jpg");
  execFileSync("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi"],
    ...["-i", "testsrc=size=640x360:rate=1:duration=1", "-frames:v", "1", file],
  ]);
  return readFileSync(file);
}

function memoryStore(initial: Record<string, Uint8Array>): PosterStore & { puts: string[] } {
  const objects = new Map(Object.entries(initial));
  const puts: string[] = [];
  return {
    puts,
    has: (key) => Promise.resolve(objects.has(key)),
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    put: (key, body) => {
      objects.set(key, body);
      puts.push(key);
      return Promise.resolve();
    },
  };
}

async function campaign(
  posterUrl: string | null,
  aspect: "16:9" | "9:16" = "16:9",
): Promise<string> {
  const id = randomUUID();
  created.push(id);
  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, captions_url, aspect, estimated_bytes,
        starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1,'long_form','Poster test',$2,'Test Merchant','A test campaign',90,
             10.5, 80, 0, 'base_only', 'live', now(), $2, 'AU', 'all_ages', 'entertainment',
             $3, 'http://127.0.0.1:26900/x/t.mp4', 'http://127.0.0.1:26900/x/i.m3u8',
             null, $4, 1000, now(), now() + interval '90 days', true, 0)`,
    [id, randomUUID(), posterUrl ?? "http://127.0.0.1:26900/x/p.jpg", aspect],
  );
  return id;
}

async function variantsOf(id: string): Promise<unknown> {
  const { rows } = await owner.query<{ poster_variants: unknown }>(
    "SELECT poster_variants FROM campaign.campaigns WHERE id = $1",
    [id],
  );
  return rows[0]?.poster_variants;
}

describe("ensurePosterLadder against campaign.campaigns", () => {
  it("defaults to no recorded sizes and refuses anything that is not a list", async () => {
    const id = await campaign(null);
    expect(await variantsOf(id)).toEqual([]);
    await expect(
      owner.query(`UPDATE campaign.campaigns SET poster_variants = '{}'::jsonb WHERE id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/campaigns_poster_variants_array/);
  });

  it("records only the sizes that exist for an older poster, and repeats as a no-op", async () => {
    const uuid = randomUUID();
    const url = `https://media.example/media/posters/${uuid}.jpg`;
    const id = await campaign(url, "9:16");
    const missingFile = await campaign(`https://media.example/media/posters/${randomUUID()}.jpg`);
    const store = memoryStore({ [`posters/${uuid}.jpg`]: jpeg() });

    await ensurePosterLadder(pgPosterRecorder(owner), () => undefined, store);
    expect(store.puts).toEqual([`posters/${uuid}-320.jpg`]);
    expect(await variantsOf(id)).toEqual([
      { url: `https://media.example/media/posters/${uuid}-320.jpg`, width: 180 },
      { url, width: 360 },
    ]);
    // A poster whose file cannot be read stays empty, so no srcset names it.
    expect(await variantsOf(missingFile)).toEqual([]);

    store.puts.length = 0;
    await ensurePosterLadder(pgPosterRecorder(owner), () => undefined, store);
    expect(store.puts).toEqual([]);
  }, 30_000);
});
