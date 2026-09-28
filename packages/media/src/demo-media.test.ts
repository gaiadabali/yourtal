import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createMediaClient, getRawObject, hlsAssetObjectKey } from "./studio-media";
import { runDemoMedia } from "./demo-media";
import type { Manifest } from "./demo-media";

/**
 * 7.2.d, against real ffmpeg, a real object store and a real Postgres — the
 * committed `demo-media.json`'s two real internet clips are NOT fetched
 * here (no external network dependency in the test suite, and no minutes-
 * long ffmpeg pass per CI run); instead this serves its own tiny generated
 * clip and a tiny generated tone from a local HTTP server, so the WHOLE
 * pipeline (fetch, burn facts, mux-if-silent, HLS/poster/teaser render,
 * object-store upload, business/campaign/question rows, idempotency) runs for
 * real end to end.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

let workDir: string;
let server: Server;
let baseUrl: string;
const pool = new pg.Pool({ connectionString: DATABASE_URL });
// `yourtal_app` (the role `pool` above and `runDemoMedia` itself use) has no
// DELETE on `campaign.question_answer_key` (an intentionally append-only-
// leaning grant elsewhere in the schema) — cleanup alone needs the owner,
// same convention `packages/db`'s own tests use for privilege-restricted teardown.
const ownerPool = new pg.Pool({
  connectionString:
    process.env["TEST_DATABASE_OWNER_URL"] ?? process.env["DATABASE_OWNER_URL"] ?? DATABASE_URL,
});

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), "yt-demo-media-fixture-"));

  // A short, silent, real clip (silent on purpose: exercises the mux-CC0-music path).
  const clipPath = path.join(workDir, "clip.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=30:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clipPath,
  ]);
  // A short, real tone, standing in for the CC0 music bed.
  const musicPath = path.join(workDir, "music.ogg");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=2",
    "-c:a",
    "libvorbis",
    musicPath,
  ]);

  server = createServer((req, res) => {
    const file = req.url === "/clip.mp4" ? clipPath : req.url === "/music.ogg" ? musicPath : null;
    if (file === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
  await pool.end();
  await ownerPool.end();
});

function fixtureManifest(slug: string): Manifest {
  return {
    musicBed: {
      url: `${baseUrl}/music.ogg`,
      licence: "test-fixture",
      attribution: "test-fixture",
      sourcePage: baseUrl,
    },
    clips: {
      test: {
        url: `${baseUrl}/clip.mp4`,
        licence: "test-fixture",
        attribution: "test-fixture",
        sourcePage: baseUrl,
      },
    },
    campaigns: [
      {
        slug,
        region: "AU",
        brand: "Demo Media Test Co.",
        clip: "test",
        teaserStartSeconds: 1,
        facts: [
          { at: 0.2, text: "Fact one" },
          { at: 0.5, text: "Fact two" },
          { at: 0.8, text: "Fact three" },
        ],
      },
    ],
  };
}

describe("runDemoMedia", () => {
  it("seeds a real business/campaign/question set and uploads real HLS/poster/teaser objects", async () => {
    const slug = `demo-media-test-${Date.now()}`;
    const manifest = fixtureManifest(slug);

    const results = await runDemoMedia({ databaseUrl: DATABASE_URL ?? "", manifest });
    expect(results).toEqual([{ slug, status: "seeded" }]);

    const campaigns = await pool.query<{
      id: string;
      lifecycle_state: string;
      hls_url: string;
      poster_url: string;
      teaser_url: string;
      question_count: number;
    }>(
      "SELECT id, lifecycle_state, hls_url, poster_url, teaser_url, question_count FROM campaign.campaigns WHERE merchant_name = $1",
      ["Demo Media Test Co."],
    );
    expect(campaigns.rows).toHaveLength(1);
    const campaign = campaigns.rows[0];
    expect(campaign?.lifecycle_state).toBe("live");
    expect(campaign?.question_count).toBe(1);

    // F65-adjacent: a bare `/media/...` path fails campaignSchema's z.url()
    // and crashes mint-manifest-url.ts's new URL() — every one of these URLs
    // must be a real, absolute URL from the moment a campaign is first seeded.
    for (const url of [campaign?.hls_url, campaign?.poster_url, campaign?.teaser_url]) {
      expect(() => new URL(url ?? "")).not.toThrow();
    }

    // F66: campaignSchema refines "long_form" to require at least one
    // campaign.chapter row (first at second 0). A freshly seeded campaign
    // must carry one from the start, not just after a later repair.
    const freshChapters = await pool.query<{ start_seconds: number }>(
      "SELECT start_seconds FROM campaign.chapter WHERE campaign_id = $1 ORDER BY ordinal",
      [campaign?.id],
    );
    expect(freshChapters.rows.length).toBeGreaterThan(0);
    expect(freshChapters.rows[0]?.start_seconds).toBe(0);

    const questions = await pool.query(
      "SELECT answerable_after_seconds FROM campaign.question WHERE campaign_id = $1 ORDER BY answerable_after_seconds",
      [campaign?.id],
    );
    expect(questions.rows).toEqual([
      { answerable_after_seconds: 18 },
      { answerable_after_seconds: 45 },
      { answerable_after_seconds: 72 },
    ]);

    // Real objects, really in the object store, at the exact keys nginx's /media/hls/ route resolves to.
    const client = createMediaClient();
    const manifestFile = await getRawObject(
      client,
      hlsAssetObjectKey(campaign?.id ?? "", "index.m3u8"),
    );
    expect(Buffer.from(manifestFile).toString()).toContain("#EXTM3U");
    client.destroy();

    // Re-running is a no-op (2.3.e's own convention): the same campaign id already has an hls_url,
    // and it is already absolute, so nothing is rewritten.
    const repeated = await runDemoMedia({ databaseUrl: DATABASE_URL ?? "", manifest });
    expect(repeated).toEqual([{ slug, status: "already_present" }]);
    const unchanged = await pool.query<{ hls_url: string }>(
      "SELECT hls_url FROM campaign.campaigns WHERE id = $1",
      [campaign?.id],
    );
    expect(unchanged.rows[0]?.hls_url).toBe(campaign?.hls_url);

    // F65-adjacent: a row written by an OLDER version of this pipeline (bare
    // `/media/...` paths, the exact shape found live on staging) must be
    // repaired in place next run, not left broken forever just because
    // `hls_url IS NOT NULL`. No re-transcode: the objects are already at
    // `campaignId`'s keys from the seed above, so this only proves the URLs
    // themselves get rewritten and nothing else changes.
    await ownerPool.query(
      `UPDATE campaign.campaigns
         SET hls_url = $2, poster_url = $3, teaser_url = $4
       WHERE id = $1`,
      [
        campaign?.id,
        `/media/hls/${String(campaign?.id)}/index.m3u8`,
        `/media/posters/${String(campaign?.id)}.jpg`,
        `/media/teasers/${String(campaign?.id)}.mp4`,
      ],
    );
    await ownerPool.query(
      "UPDATE campaign.video_source SET manifest_url = $2 WHERE campaign_id = $1",
      [campaign?.id, `/media/hls/${String(campaign?.id)}/index.m3u8`],
    );

    const repairResult = await runDemoMedia({ databaseUrl: DATABASE_URL ?? "", manifest });
    expect(repairResult).toEqual([{ slug, status: "repaired" }]);

    const repaired = await pool.query<{
      hls_url: string;
      poster_url: string;
      teaser_url: string;
    }>("SELECT hls_url, poster_url, teaser_url FROM campaign.campaigns WHERE id = $1", [
      campaign?.id,
    ]);
    expect(repaired.rows[0]?.hls_url).toBe(campaign?.hls_url);
    expect(repaired.rows[0]?.poster_url).toBe(campaign?.poster_url);
    expect(repaired.rows[0]?.teaser_url).toBe(campaign?.teaser_url);
    for (const url of [
      repaired.rows[0]?.hls_url,
      repaired.rows[0]?.poster_url,
      repaired.rows[0]?.teaser_url,
    ]) {
      expect(() => new URL(url ?? "")).not.toThrow();
    }
    const videoSource = await pool.query<{ manifest_url: string }>(
      "SELECT manifest_url FROM campaign.video_source WHERE campaign_id = $1",
      [campaign?.id],
    );
    expect(videoSource.rows[0]?.manifest_url).toBe(campaign?.hls_url);

    // F66: the exact state QA found live on staging — URLs already absolute
    // (an earlier repair already fixed those) but zero chapters, because an
    // even earlier version of this seed never wrote any. Must be repaired
    // independently of the URL check above, not skipped because hls_url
    // already looks fine.
    await ownerPool.query("DELETE FROM campaign.chapter WHERE campaign_id = $1", [campaign?.id]);
    const noChapters = await pool.query("SELECT 1 FROM campaign.chapter WHERE campaign_id = $1", [
      campaign?.id,
    ]);
    expect(noChapters.rowCount).toBe(0);

    const chapterRepairResult = await runDemoMedia({ databaseUrl: DATABASE_URL ?? "", manifest });
    expect(chapterRepairResult).toEqual([{ slug, status: "repaired" }]);

    const restoredChapters = await pool.query<{ title: string; start_seconds: number }>(
      "SELECT title, start_seconds FROM campaign.chapter WHERE campaign_id = $1 ORDER BY ordinal",
      [campaign?.id],
    );
    expect(restoredChapters.rows.length).toBeGreaterThan(0);
    expect(restoredChapters.rows[0]?.start_seconds).toBe(0);
    // URLs untouched by a chapter-only repair.
    const urlsAfterChapterRepair = await pool.query<{ hls_url: string }>(
      "SELECT hls_url FROM campaign.campaigns WHERE id = $1",
      [campaign?.id],
    );
    expect(urlsAfterChapterRepair.rows[0]?.hls_url).toBe(campaign?.hls_url);

    await ownerPool.query(
      "DELETE FROM campaign.question_answer_key WHERE question_id IN (SELECT id FROM campaign.question WHERE campaign_id = $1)",
      [campaign?.id],
    );
    await ownerPool.query(
      "DELETE FROM campaign.question_option WHERE question_id IN (SELECT id FROM campaign.question WHERE campaign_id = $1)",
      [campaign?.id],
    );
    await ownerPool.query("DELETE FROM campaign.question WHERE campaign_id = $1", [campaign?.id]);
    await ownerPool.query("DELETE FROM campaign.terms_version WHERE campaign_id = $1", [
      campaign?.id,
    ]);
    await ownerPool.query("DELETE FROM campaign.video_source WHERE campaign_id = $1", [
      campaign?.id,
    ]);
    await ownerPool.query("DELETE FROM campaign.campaigns WHERE id = $1", [campaign?.id]);
    await ownerPool.query("DELETE FROM business.business_accounts WHERE display_name = $1", [
      "Demo Media Test Co.",
    ]);
  }, 60_000);
});
