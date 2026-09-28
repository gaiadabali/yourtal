import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  readonly durationSeconds: number;
  /** "16:9" for landscape (or square), "9:16" for portrait — campaign.campaigns' own CHECK values. */
  readonly aspect: "16:9" | "9:16";
}

/** ffprobe the source once, for the facts every other step needs (7.2.b). */
export async function probeInput(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: readonly { width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const width = stream?.width;
  const height = stream?.height;
  const duration = parsed.format?.duration;
  if (width === undefined || height === undefined || duration === undefined) {
    throw new Error(`ffprobe could not read a video stream/duration from ${filePath}`);
  }
  return {
    durationSeconds: Math.round(Number.parseFloat(duration)),
    aspect: width >= height ? "16:9" : "9:16",
  };
}

/** One rendition of the HLS ladder (7.2.b: 360p/540p/720p, 6 s segments). */
export interface HlsRendition {
  readonly dir: string;
  readonly height: number;
  readonly videoBitrateKbps: number;
}

export const HLS_LADDER: readonly HlsRendition[] = [
  { dir: "v0", height: 360, videoBitrateKbps: 800 },
  { dir: "v1", height: 540, videoBitrateKbps: 1400 },
  { dir: "v2", height: 720, videoBitrateKbps: 2500 },
];

const SEGMENT_SECONDS = 6;

/**
 * Renders the whole ABR ladder plus its master playlist into `outputDir` in
 * one ffmpeg pass — the same `split`+`scale`+`-var_stream_map` shape
 * `packages/media/scripts/generate-fixture.mjs` already uses for the
 * fixture, so the two never describe two different ways to build one.
 * Returns each rendition's produced byte size, for `estimatedBytes`
 * (540p/v1) and Studio's own display.
 */
export interface HlsRenditionBytes {
  readonly v360: number;
  readonly v540: number;
  readonly v720: number;
}

export async function renderHlsLadder(
  inputPath: string,
  outputDir: string,
): Promise<HlsRenditionBytes> {
  const scaleGraph = [
    `[0:v]split=${String(HLS_LADDER.length)}${HLS_LADDER.map((_, i) => `[s${String(i)}]`).join("")}`,
    ...HLS_LADDER.map(
      (rung, i) => `[s${String(i)}]scale=-2:${String(rung.height)}[v${String(i)}out]`,
    ),
  ].join(";");

  const rungArgs = HLS_LADDER.flatMap((rung, i) => [
    "-map",
    `[v${String(i)}out]`,
    `-b:v:${String(i)}`,
    `${String(rung.videoBitrateKbps)}k`,
    `-maxrate:v:${String(i)}`,
    `${String(Math.round(rung.videoBitrateKbps * 1.1))}k`,
    `-bufsize:v:${String(i)}`,
    `${String(rung.videoBitrateKbps * 2)}k`,
  ]);

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    scaleGraph,
    ...rungArgs,
    ...HLS_LADDER.flatMap(() => ["-map", "a:0?"]),
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-preset",
    "veryfast",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    // F66-adjacent (found 2026-09-28, 7.2.f): `-g`/`-keyint_min` as a FRAME
    // count assumed 30 fps (`SEGMENT_SECONDS * 30`), so a source at any
    // other frame rate got the wrong keyframe interval and therefore the
    // wrong segment length -- a real 24 fps clip produced 7.5 s segments,
    // not 6 s (180 frames / 24 fps), and every test clip here happened to
    // be a synthetic 30 fps `testsrc`, which hid it. `-force_key_frames`
    // with a time expression forces a keyframe every SEGMENT_SECONDS of
    // PLAYBACK TIME regardless of the input's frame rate, so `-hls_time`
    // always finds one to cut on.
    "-force_key_frames",
    `expr:gte(t,n_forced*${String(SEGMENT_SECONDS)})`,
    "-sc_threshold",
    "0",
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SECONDS),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "mpegts",
    "-var_stream_map",
    HLS_LADDER.map((_, i) => `v:${String(i)},a:${String(i)}`).join(" "),
    "-master_pl_name",
    "index.m3u8",
    // Forward slashes always: ffmpeg copies the separator it is given into
    // the URIs it writes into the master playlist (generate-fixture.mjs's
    // own note on this). `path.join` on Windows would corrupt every entry.
    "-hls_segment_filename",
    `${outputDir.split(path.sep).join("/")}/v%v/segment%d.ts`,
    `${outputDir.split(path.sep).join("/")}/v%v/index.m3u8`,
  ]);

  function bytesOf(dir: string): number {
    const full = path.join(outputDir, dir);
    return readdirSync(full).reduce((sum, file) => sum + statSync(path.join(full, file)).size, 0);
  }
  return { v360: bytesOf("v0"), v540: bytesOf("v1"), v720: bytesOf("v2") };
}

/** A poster frame, taken partway through the clip so it is rarely a black opening frame. */
export async function renderPoster(
  inputPath: string,
  outputPath: string,
  atSeconds: number,
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(atSeconds),
    "-i",
    inputPath,
    "-vframes",
    "1",
    "-q:v",
    "3",
    outputPath,
  ]);
}

export interface TeaserInput {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly startSeconds: number;
  readonly aspect: "16:9" | "9:16";
}

const TEASER_DURATION_SECONDS = 15;
const TEASER_WIDTH = 540;
const TEASER_HEIGHT = 960;
/**
 * Budgeted under 7.2.b's 800 kbps/1.5 MB ceiling with margin: 15 s at
 * (620 + 64) kbps is ~1.28 MB, and `-fs` below is the hard backstop.
 */
const TEASER_VIDEO_KBPS = 620;
const TEASER_AUDIO_KBPS = 64;
const TEASER_MAX_BYTES = 1.5 * 1024 * 1024;

/**
 * The teaser (7.2.b). A 9:16 source is scaled/cropped straight to
 * 540x960. A 16:9 source is not cropped: scaled to width and centred on a
 * blurred, zoomed copy of the same frame filling the rest of the canvas.
 */
export async function renderTeaser(input: TeaserInput): Promise<void> {
  const filter =
    input.aspect === "9:16"
      ? `scale=${String(TEASER_WIDTH)}:${String(TEASER_HEIGHT)}:force_original_aspect_ratio=increase,` +
        `crop=${String(TEASER_WIDTH)}:${String(TEASER_HEIGHT)}`
      : [
          `[0:v]scale=${String(TEASER_WIDTH)}:-2,setsar=1[fg]`,
          `[0:v]scale=${String(TEASER_WIDTH)}:${String(TEASER_HEIGHT)}:force_original_aspect_ratio=increase,` +
            `crop=${String(TEASER_WIDTH)}:${String(TEASER_HEIGHT)},gblur=sigma=20[bg]`,
          `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p`,
        ].join(";");

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(input.startSeconds),
    "-i",
    input.inputPath,
    "-t",
    String(TEASER_DURATION_SECONDS),
    ...(input.aspect === "9:16" ? ["-vf", filter] : ["-filter_complex", filter]),
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    `${String(TEASER_VIDEO_KBPS)}k`,
    "-maxrate",
    `${String(Math.round(TEASER_VIDEO_KBPS * 1.1))}k`,
    "-bufsize",
    `${String(TEASER_VIDEO_KBPS * 2)}k`,
    "-c:a",
    "aac",
    "-b:a",
    `${String(TEASER_AUDIO_KBPS)}k`,
    "-movflags",
    "+faststart",
    // Hard backstop on top of the bitrate budget above.
    "-fs",
    String(TEASER_MAX_BYTES),
    input.outputPath,
  ]);
}
