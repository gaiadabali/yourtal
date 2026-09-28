import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
// Imported, not read off disk at runtime: `main-staging.ts` (2.3.e) bundles
// this whole module into one file with esbuild (`scripts/build-service.mjs
// seed`), and a path built from `import.meta.url` at runtime then points at
// wherever that BUNDLE landed in the release, not at this source file's own
// directory — which is exactly the bug that broke every staging deploy
// after this shipped (F51/coordinator report). `with { type: "json" }`
// makes esbuild inline the manifest's contents into the bundle at build
// time, so there is no file to find at runtime at all.
import demoMediaManifestJson from "../demo-media.json" with { type: "json" };
import { probeInput, renderHlsLadder, renderPoster, renderTeaser } from "./ffmpeg-transcode";
import {
  createMediaClient,
  hlsAssetObjectKey,
  posterObjectKey,
  putMediaOutput,
  teaserObjectKey,
} from "./studio-media";

/**
 * The demo media kit (TASKS.md 7.2.d/e, F7): `pnpm demo:media` turns
 * `demo-media.json` into real campaigns on whatever database
 * `DATABASE_OWNER_URL` names — a real Postgres write, real ffmpeg, real
 * object-store objects, exactly the pipeline 7.2.a/b/c already proved end to end.
 *
 * Idempotent by campaign id (derived from the manifest slug): a campaign
 * already marked "ready" is left alone, so a normal deploy re-run (2.3.e's
 * own convention) processes nothing. Delete the row to force a rebuild.
 *
 * ## Why every clip is looped/trimmed to one fixed duration
 *
 * Both real source trailers (Big Buck Bunny, Sintel) run under 60s natively.
 * F10 (TASKS.md) is explicit: under 60s asks no questions at all, which
 * would make "generate questions from the facts" produce a bank nothing
 * ever draws from. Every campaign here is looped to `TARGET_DURATION_SECONDS`
 * instead, which is comfortably inside F10's 1-question tier
 * (`max(1, min(5, floor(d/300)))`) and keeps every fact's `at` fraction
 * meaningful regardless of the source clip's native length.
 *
 * ## What this does NOT do
 *
 * It does not fund a ledger allocation for these campaigns (a separate,
 * real-money-backed concern — K6 — well outside a media-pipeline script's
 * business). They are real, viewable, question-bearing campaigns; actually
 * earning against them needs the same funding step `seed/staging.ts` already
 * runs for its own fixture campaign, which is Area A's to extend to these.
 */

// Overridable so a deploy that gets a fresh checkout per release (2.1.b)
// can point this at a persistent path OUTSIDE the release directory (e.g.
// `/opt/yourtal/data/demo-media-cache` — the release dir itself is not
// guaranteed writable by `uyourtal`, and is deleted/replaced on every
// deploy regardless). The default is `os.tmpdir()`, deliberately NOT
// anything derived from this module's own on-disk location: once bundled
// (see the JSON import above), that location is the release's `dist/`, and
// a cache under it would vanish every deploy anyway. Correctness never
// depends on any of this: the DB check (`hls_url IS NOT NULL`) is what
// makes a re-run a no-op, a cold cache only costs time re-fetching and
// re-transcoding.
const CACHE_DIR = process.env["DEMO_MEDIA_CACHE_DIR"] ?? path.join(tmpdir(), "demo-media-cache");

/** F10's own 60s floor, plus margin: every demo campaign lands at exactly this length. */
const TARGET_DURATION_SECONDS = 90;
/** F10: max(1, min(5, floor(90/300))) = 1. */
const QUESTION_COUNT = 1;

export interface ManifestSource {
  readonly url: string;
  readonly licence: string;
  readonly attribution: string;
  readonly sourcePage: string;
}

export interface ManifestFact {
  readonly at: number; // fraction of TARGET_DURATION_SECONDS, 0..1
  readonly text: string;
}

export interface ManifestCampaign {
  readonly slug: string;
  readonly region: "AU" | "ID";
  readonly brand: string;
  readonly clip: string;
  readonly teaserStartSeconds: number;
  readonly facts: readonly ManifestFact[];
}

export interface Manifest {
  readonly musicBed: ManifestSource;
  readonly clips: Record<string, ManifestSource>;
  readonly campaigns: readonly ManifestCampaign[];
}

function loadManifest(): Manifest {
  // `JSON.parse(JSON.stringify(...))`: the imported JSON is already parsed
  // (that is what `with { type: "json" }` means), but its inferred type is
  // a structural match rather than literally `Manifest` — the same "trust
  // the shape, don't re-derive it" cast every other JSON-import in this
  // codebase uses, and cheaper than validating a file this package itself
  // owns and already typechecks against via `ManifestCampaign` etc.
  return demoMediaManifestJson as Manifest;
}

/** A stable UUID from a string (SHA-256, shaped as a version-5 UUID) — same technique `unlockJobId` (apps/worker/src/jobs/points-unlocked.ts) uses, so re-running this script always names the same rows. Exported so a caller that needs to name a row against ONE of these businesses (7.2.e's own listing/voucher seed) derives the SAME id rather than inventing a second scheme. */
export function stableId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * `drawtext` needs an explicit font file: this ffmpeg build has no
 * fontconfig, so a bare `drawtext` (relying on fontconfig to find a
 * default) segfaults — the same finding `packages/media/scripts/
 * generate-fixture.mjs` documents for its own timecode overlay. Passing
 * `fontfile=` sidesteps fontconfig entirely and works on every platform
 * that has ANY of the files below.
 */
function resolveFontFile(): string {
  const override = process.env["DEMO_MEDIA_FONT_FILE"];
  if (override !== undefined && existsSync(override)) return override;
  const candidates = [
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      "No usable font file found for drawtext. Set DEMO_MEDIA_FONT_FILE to a .ttf/.otf path.",
    );
  }
  return found;
}

async function downloadToCache(url: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const ext = path.extname(new URL(url).pathname) || ".bin";
  const localPath = path.join(CACHE_DIR, `${createHash("sha256").update(url).digest("hex")}${ext}`);
  if (existsSync(localPath) && statSync(localPath).size > 0) return localPath;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} -> ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(localPath, bytes);
  return localPath;
}

/** ffmpeg's filter-graph escaping for a colon-bearing Windows path and a quoted text argument. */
function escapeForFilter(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:");
}
function escapeDrawtext(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

const FACT_DISPLAY_SECONDS = 5;

/**
 * Loops/trims the source to `TARGET_DURATION_SECONDS` and burns every fact
 * in as on-screen text at its resolved timestamp, in one ffmpeg pass.
 */
function burnFacts(inputPath: string, facts: readonly ManifestFact[], outputPath: string): void {
  const fontFile = escapeForFilter(resolveFontFile());
  const drawtextFilters = facts.map((fact) => {
    const atSeconds = Math.round(fact.at * TARGET_DURATION_SECONDS);
    const endSeconds = Math.min(TARGET_DURATION_SECONDS, atSeconds + FACT_DISPLAY_SECONDS);
    return (
      `drawtext=fontfile='${fontFile}':text='${escapeDrawtext(fact.text)}':` +
      // `expansion=none`: a fact's text is a literal string, never a
      // `%{...}` expression, and without this a bare "%" (as in "100%
      // Arabica beans") is parsed as a stray expansion token and warned on
      // for every frame — found against the real facts in demo-media.json.
      `expansion=none:x=(w-text_w)/2:y=h-th-40:fontsize=28:fontcolor=white:` +
      `box=1:boxcolor=black@0.5:boxborderw=10:` +
      `enable='between(t,${String(atSeconds)},${String(endSeconds)})'`
    );
  });
  // `scale=trunc(iw/2)*2:...` first: libx264/yuv420p refuses an odd
  // dimension, and Big Buck Bunny's own trailer is 853x480 (853 is odd) —
  // found the hard way, against the real source, not a guess.
  const filter = ["[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,", drawtextFilters.join(","), "[v]"].join(
    "",
  );

  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    inputPath,
    "-t",
    String(TARGET_DURATION_SECONDS),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    outputPath,
  ]);
}

/** Mixes the CC0 bed under the clip's own audio if it has none (F7); a pass-through copy otherwise. */
function muxMusicIfSilent(
  inputPath: string,
  hasAudio: boolean,
  musicPath: string,
  outputPath: string,
): void {
  if (hasAudio) {
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-c",
      "copy",
      outputPath,
    ]);
    return;
  }
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-stream_loop",
    "-1",
    "-i",
    musicPath,
    "-shortest",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    outputPath,
  ]);
}

function hasAudioStream(filePath: string): boolean {
  const stdout = execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    filePath,
  ]).toString();
  return stdout.trim().length > 0;
}

/** A simple coloured-circle initials monogram — no external asset, embeddable as a data URI. */
function svgMonogram(brand: string): string {
  const initials = brand
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  const hue = Array.from(brand).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    `<circle cx="64" cy="64" r="64" fill="hsl(${String(hue)},55%,45%)"/>` +
    `<text x="64" y="80" font-family="sans-serif" font-size="48" font-weight="700" ` +
    `fill="white" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export interface DemoMediaResult {
  readonly slug: string;
  readonly status: "seeded" | "already_present" | "failed";
  readonly detail?: string;
}

export interface RunDemoMediaOptions {
  readonly databaseUrl: string;
  readonly log?: (message: string) => void;
  /** Overrides the committed `demo-media.json` — how `demo-media.test.ts` runs a real but tiny manifest. */
  readonly manifest?: Manifest;
}

export interface DemoMediaBusiness {
  readonly slug: string;
  readonly region: "AU" | "ID";
  readonly brand: string;
  /** Same id `ensureBusiness` below inserts under — a caller names a row
   * against one of these businesses (7.2.e's listing/voucher seed) without
   * re-deriving `stableId`'s scheme or re-reading the manifest itself. */
  readonly businessId: string;
}

/** Every business `runDemoMedia` creates (or will create), independent of
 * whether it has actually run yet — `main-staging.ts` calls this AFTER
 * `runDemoMedia` in the same seed, so by the time a caller uses this list
 * every id it names is a real `business.business_accounts` row. */
export function listDemoMediaBusinesses(manifest?: Manifest): readonly DemoMediaBusiness[] {
  return (manifest ?? loadManifest()).campaigns.map((entry) => ({
    slug: entry.slug,
    region: entry.region,
    brand: entry.brand,
    businessId: stableId(`demo-media:business:${entry.slug}`),
  }));
}

export async function runDemoMedia(
  options: RunDemoMediaOptions,
): Promise<readonly DemoMediaResult[]> {
  const log = options.log ?? console.log;
  const manifest = options.manifest ?? loadManifest();
  const pool = new pg.Pool({ connectionString: options.databaseUrl });
  const results: DemoMediaResult[] = [];

  try {
    const musicPath = await downloadToCache(manifest.musicBed.url);

    for (const entry of manifest.campaigns) {
      try {
        results.push(await seedOneCampaign(pool, manifest, entry, musicPath, log));
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        log(`[demo:media] ${entry.slug} failed: ${detail}`);
        results.push({ slug: entry.slug, status: "failed", detail });
      }
    }
  } finally {
    await pool.end();
  }
  return results;
}

async function seedOneCampaign(
  pool: pg.Pool,
  manifest: Manifest,
  entry: ManifestCampaign,
  musicPath: string,
  log: (message: string) => void,
): Promise<DemoMediaResult> {
  const businessId = stableId(`demo-media:business:${entry.slug}`);
  const campaignId = stableId(`demo-media:campaign:${entry.slug}`);

  const existing = await pool.query<{ lifecycle_state: string; hls_url: string | null }>(
    "SELECT lifecycle_state, hls_url FROM campaign.campaigns WHERE id = $1",
    [campaignId],
  );
  if (existing.rows[0]?.hls_url != null) {
    return { slug: entry.slug, status: "already_present" };
  }

  const clip = manifest.clips[entry.clip];
  if (clip === undefined) throw new Error(`no clip named "${entry.clip}" in the manifest`);

  const workDir = path.join(CACHE_DIR, "work", entry.slug);
  mkdirSync(workDir, { recursive: true });
  const sourcePath = await downloadToCache(clip.url);

  const burnedPath = path.join(workDir, "burned.mp4");
  burnFacts(sourcePath, entry.facts, burnedPath);
  const finalPath = path.join(workDir, "final.mp4");
  muxMusicIfSilent(burnedPath, hasAudioStream(burnedPath), musicPath, finalPath);
  // aspect/duration read from the FINAL clip (post-loop, post-mux).
  const final = await probeInput(finalPath);

  const hlsDir = path.join(workDir, "hls");
  mkdirSync(hlsDir, { recursive: true });
  const renditionBytes = await renderHlsLadder(finalPath, hlsDir);
  const posterPath = path.join(workDir, "poster.jpg");
  await renderPoster(finalPath, posterPath, 5);
  const teaserPath = path.join(workDir, "teaser.mp4");
  await renderTeaser({
    inputPath: finalPath,
    outputPath: teaserPath,
    startSeconds: entry.teaserStartSeconds,
    aspect: final.aspect,
  });

  const client = createMediaClient();
  for (const file of listFiles(hlsDir)) {
    await putMediaOutput(client, {
      kind: "hls",
      key: hlsAssetObjectKey(campaignId, file),
      body: readFileSync(path.join(hlsDir, ...file.split("/"))),
    });
  }
  await putMediaOutput(client, {
    kind: "poster",
    key: posterObjectKey(campaignId),
    body: readFileSync(posterPath),
  });
  await putMediaOutput(client, {
    kind: "teaser",
    key: teaserObjectKey(campaignId),
    body: readFileSync(teaserPath),
  });
  client.destroy();

  const posterUrl = `/media/posters/${campaignId}.jpg`;
  const teaserUrl = `/media/teasers/${campaignId}.mp4`;
  const hlsUrl = `/media/hls/${campaignId}/index.m3u8`;

  await ensureBusiness(pool, businessId, entry);
  await ensureCampaign(pool, {
    campaignId,
    businessId,
    entry,
    durationSeconds: TARGET_DURATION_SECONDS,
    estimatedBytes: renditionBytes.v540,
    posterUrl,
    teaserUrl,
    hlsUrl,
  });
  await ensureQuestions(pool, campaignId, entry.facts);

  log(
    `[demo:media] ${entry.slug}: ${clip.attribution} (${clip.licence}) -> ${hlsUrl}, ${entry.facts.length} facts/questions`,
  );
  return { slug: entry.slug, status: "seeded" };
}

function listFiles(root: string, prefix = ""): string[] {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entryDirent) => {
    const rel = prefix === "" ? entryDirent.name : `${prefix}/${entryDirent.name}`;
    return entryDirent.isDirectory() ? listFiles(root, rel) : [rel];
  });
}

async function ensureBusiness(
  pool: pg.Pool,
  businessId: string,
  entry: ManifestCampaign,
): Promise<void> {
  const exists = await pool.query("SELECT 1 FROM business.business_accounts WHERE id = $1", [
    businessId,
  ]);
  if ((exists.rowCount ?? 0) > 0) return;

  const currency = entry.region === "AU" ? "AUD" : "IDR";
  const taxIdKind = entry.region === "AU" ? "ABN" : "NPWP";
  const taxIdValue = entry.region === "AU" ? "51824753556" : "012345678901234";
  await pool.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, roles, is_verified, logo_url, region, currency, handle,
        tax_id_kind, tax_id_value, address_state, address_postcode, address_city)
     VALUES ($1,$2,$2,'["advertiser"]'::jsonb, true, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      businessId,
      entry.brand,
      svgMonogram(entry.brand),
      entry.region,
      currency,
      `demo-${entry.slug}`,
      taxIdKind,
      taxIdValue,
      entry.region === "AU" ? "NSW" : null,
      entry.region === "AU" ? "2000" : null,
      entry.region === "ID" ? "Jakarta" : null,
    ],
  );
}

interface EnsureCampaignInput {
  readonly campaignId: string;
  readonly businessId: string;
  readonly entry: ManifestCampaign;
  readonly durationSeconds: number;
  readonly estimatedBytes: number;
  readonly posterUrl: string;
  readonly teaserUrl: string;
  readonly hlsUrl: string;
}

async function ensureCampaign(pool: pg.Pool, input: EnsureCampaignInput): Promise<void> {
  const {
    campaignId,
    businessId,
    entry,
    durationSeconds,
    estimatedBytes,
    posterUrl,
    teaserUrl,
    hlsUrl,
  } = input;
  const now = new Date();
  const publishedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const rewardPoints = 80;

  await pool.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, estimated_data_mb,
        reward_points, question_count, scoring_rule, lifecycle_state, published_at, business_id,
        region, audience, content_category, poster_url, teaser_url, hls_url, aspect,
        estimated_bytes, starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1,'long_form',$2,$3,$4,$5,$6,$7,$8,$9,'base_only','live',$10,$3,$11,'all_ages',
             'entertainment',$12,$13,$14,'16:9',$15,$10,$16,false,$17)
     ON CONFLICT (id) DO UPDATE SET
       poster_url = EXCLUDED.poster_url, teaser_url = EXCLUDED.teaser_url,
       hls_url = EXCLUDED.hls_url, estimated_bytes = EXCLUDED.estimated_bytes`,
    [
      campaignId,
      `${entry.brand} \u2014 demo campaign (7.2.d)`,
      businessId,
      entry.brand,
      `A demo ad for ${entry.brand}, generated by pnpm demo:media (F7).`,
      durationSeconds,
      (estimatedBytes / (1024 * 1024)).toFixed(2),
      rewardPoints,
      QUESTION_COUNT,
      publishedAt,
      entry.region,
      posterUrl,
      teaserUrl,
      hlsUrl,
      estimatedBytes,
      endsAt,
      entry.teaserStartSeconds,
    ],
  );

  await pool.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
     VALUES ($1, 1, $2, $3, 'base_only', $4, 0, $5)
     ON CONFLICT DO NOTHING`,
    [campaignId, rewardPoints, QUESTION_COUNT, durationSeconds, publishedAt],
  );
  await pool.query(
    `INSERT INTO campaign.video_source (campaign_id, kind, manifest_url) VALUES ($1,'hls',$2)
     ON CONFLICT (campaign_id) DO UPDATE SET manifest_url = EXCLUDED.manifest_url`,
    [campaignId, hlsUrl],
  );
}

/** One question per fact, `answerableAfterSeconds` = the fact's own burned-in timestamp (7.2.d). */
async function ensureQuestions(
  pool: pg.Pool,
  campaignId: string,
  facts: readonly ManifestFact[],
): Promise<void> {
  const already = await pool.query(
    "SELECT 1 FROM campaign.question WHERE campaign_id = $1 LIMIT 1",
    [campaignId],
  );
  if ((already.rowCount ?? 0) > 0) return;

  const allTexts = facts.map((fact) => fact.text);
  for (const fact of facts) {
    const answerableAfterSeconds = Math.round(fact.at * TARGET_DURATION_SECONDS);
    const questionId = stableId(`demo-media:question:${campaignId}:${fact.text}`);
    await pool.query(
      `INSERT INTO campaign.question (id, campaign_id, type, prompt, timer_seconds, status, pii_screen, answerable_after_seconds)
       VALUES ($1,$2,'multiple_choice','What did the video say?',30,'approved','clear',$3)`,
      [questionId, campaignId, answerableAfterSeconds],
    );
    const distractors = allTexts.filter((text) => text !== fact.text).slice(0, 2);
    const options = shuffle([fact.text, ...distractors]);
    let correctOptionId = "";
    for (const [ordinal, label] of options.entries()) {
      const optionId = stableId(`demo-media:option:${questionId}:${label}`);
      if (label === fact.text) correctOptionId = optionId;
      await pool.query(
        "INSERT INTO campaign.question_option (id, question_id, label, ordinal) VALUES ($1,$2,$3,$4)",
        [optionId, questionId, label, ordinal],
      );
    }
    await pool.query(
      "INSERT INTO campaign.question_answer_key (question_id, correct_option_id) VALUES ($1,$2)",
      [questionId, correctOptionId],
    );
  }
}

/** Deterministic-enough shuffle (facts are few and this only orders demo options, never anything security-relevant). */
function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

function resolveDatabaseOwnerUrl(): string {
  const value = process.env["DATABASE_OWNER_URL"] ?? process.env["DATABASE_URL"];
  if (value === undefined) {
    throw new Error("DATABASE_OWNER_URL (or DATABASE_URL) must be set.");
  }
  return value;
}

async function main(): Promise<void> {
  const results = await runDemoMedia({ databaseUrl: resolveDatabaseOwnerUrl() });
  const seeded = results.filter((r) => r.status === "seeded").length;
  const already = results.filter((r) => r.status === "already_present").length;
  const failed = results.filter((r) => r.status === "failed");
  console.log(
    `[demo:media] ${String(seeded)} seeded, ${String(already)} already present, ${String(failed.length)} failed (of ${String(results.length)}).`,
  );
  if (failed.length > 0) {
    for (const failure of failed)
      console.error(`  - ${failure.slug}: ${failure.detail ?? "unknown error"}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("demo-media.ts") === true) {
  await main();
}
