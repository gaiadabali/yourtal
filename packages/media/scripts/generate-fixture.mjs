#!/usr/bin/env node
/**
 * Regenerates the committed HLS fixture. YT-0521 / YT-0526.
 *
 *   node scripts/generate-fixture.mjs
 *
 * ## Why the output is committed rather than generated on demand
 *
 * Running this needs ffmpeg. Making `pnpm dev:up` need ffmpeg would put a
 * native media toolchain between a new contributor and a working stack, for
 * test media that changes approximately never. So the segments are
 * committed and this script exists to make them reproducible rather than
 * mysterious — `hls-fixture.test.ts` asserts the committed files still match
 * what the parameters below describe, so the two cannot drift apart.
 *
 * ## Why these parameters
 *
 * **5 segments of 4 seconds**, 20 seconds total. YT-0412's keyboard-seeking
 * criterion was *untestable, not failing*: the shared placeholder stream had
 * a 59 MB segment that aborted before the video element ever reported a
 * duration, and you cannot assert a seek against a video with no duration.
 * Multi-segment matters as much as small — a single-segment stream cannot
 * exercise segment-boundary seeking, and per-segment delivery logging has
 * nothing to count.
 *
 * **`testsrc`, not `smptebars` or a solid colour.** It renders a running
 * frame counter and a sweeping second hand using a built-in bitmap font, so
 * a seek is verifiable from the decoded picture alone. (`drawtext` would be
 * the obvious way to burn in a timecode, and it segfaults here — it needs
 * fontconfig, which this Windows ffmpeg build has no default config for. The
 * built-in counter needs no font at all.)
 *
 * **`-pix_fmt yuv420p`** because `testsrc` emits 4:4:4 and x264's baseline
 * profile rejects it outright. Baseline/level 3.0 is the widest-compatibility
 * combination and the one a real ABR ladder's lowest rung would use.
 *
 * **Audio included**, at 32 kbit mono. It costs ~80 KB and buys a genuinely
 * representative stream: hls.js demuxes and synchronises two tracks, which is
 * a different code path from video-only, and it is the path production will
 * take.
 *
 * **Three renditions and a master playlist, not one stream.** The placeholder
 * this replaces is Apple's `bipbop_16x9_variant.m3u8`, and `video-source.ts`
 * says it was chosen deliberately over a single-bitrate file because it ships
 * a genuine ABR ladder for the quality selector to switch between. A
 * single-rendition fixture would have fixed the seeking bug and broken the
 * quality selector — trading one untestable feature for another. The rungs
 * are 320x180, 480x270 and 640x360 with separated bitrates, so
 * `BANDWIDTH` rises monotonically: hls.js picks by bandwidth, and a ladder
 * whose top rung advertises less than its middle one selects incoherently.
 *
 * The cost is 2.7 MB in git. Worth it to take an external CDN out of every
 * player test — an offline machine, or Apple moving that asset, currently
 * breaks the player suite with a network error.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(packageRoot, "fixtures", "attention-30s");

/** Kept in step with `hls-fixture.test.ts`, which asserts the committed output. */
export const FIXTURE_SHAPE = {
  durationSeconds: 30,
  segmentSeconds: 4,
  segmentCount: 5,
  frameRate: 30,
  /** Lowest rung first. `BANDWIDTH` must rise with resolution. */
  renditions: [
    { dir: "v0", width: 320, height: 180, videoBitrate: "150k" },
    { dir: "v1", width: 480, height: 270, videoBitrate: "400k" },
    { dir: "v2", width: 640, height: 360, videoBitrate: "800k" },
  ],
};

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const { durationSeconds, segmentSeconds, frameRate, renditions } = FIXTURE_SHAPE;
const source = renditions[renditions.length - 1];

/** ffmpeg output paths, with URI-safe separators. See the note below. */
function posix(...parts) {
  return parts.join("/").split("\\").join("/");
}

const scaleGraph = [
  `[0:v]split=${renditions.length}${renditions.map((_, index) => `[s${index}]`).join("")}`,
  ...renditions.map((rung, index) => `[s${index}]scale=${rung.width}:${rung.height}[v${index}out]`),
].join(";");

const rungArgs = renditions.flatMap((rung, index) => [
  "-map",
  `[v${index}out]`,
  `-b:v:${index}`,
  rung.videoBitrate,
  // A cap and a buffer, or x264 treats the bitrate as a loose average and
  // the rungs converge — at which point the ladder advertises three levels
  // that are not meaningfully different.
  `-maxrate:v:${index}`,
  `${Math.round(Number.parseInt(rung.videoBitrate, 10) * 1.1)}k`,
  `-bufsize:v:${index}`,
  `${Number.parseInt(rung.videoBitrate, 10) * 2}k`,
]);

execFileSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${source.width}x${source.height}:rate=${frameRate}:duration=${durationSeconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=44100:duration=${durationSeconds}`,
    "-filter_complex",
    scaleGraph,
    ...rungArgs,
    // One audio map per rendition: each variant playlist must carry its own
    // audio, or a level switch drops the sound.
    ...renditions.flatMap(() => ["-map", "1:a:0"]),
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "32k",
    "-ac",
    "1",
    "-preset",
    "veryfast",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    "-pix_fmt",
    "yuv420p",
    // One keyframe per segment, no scene-cut keyframes. Every segment must
    // start on an IDR frame or a player cannot begin decoding at a segment
    // boundary — which is what seeking does, and what switching level does.
    "-g",
    String(segmentSeconds * frameRate),
    "-keyint_min",
    String(segmentSeconds * frameRate),
    "-sc_threshold",
    "0",
    "-f",
    "hls",
    "-hls_time",
    String(segmentSeconds),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "mpegts",
    "-var_stream_map",
    renditions.map((_, index) => `v:${index},a:${index}`).join(" "),
    "-master_pl_name",
    "index.m3u8",
    // Forward slashes, deliberately, even on Windows. `path.join` yields
    // backslashes there, and ffmpeg copies the separator it was handed into
    // the URIs it writes INTO the master playlist — producing entries like
    // `v0\index.m3u8`, which is not a valid URI path. The master would look
    // correct and list three renditions, and every one of them would fail to
    // resolve in a player: a stream that is broken everywhere except where
    // you look first. Caught by `hls-fixture.test.ts`; do not "tidy" this
    // back into `path.join`.
    "-hls_segment_filename",
    posix(outputDir, "v%v", "segment%d.ts"),
    posix(outputDir, "v%v", "index.m3u8"),
  ],
  { stdio: "inherit" },
);

console.log(
  `Wrote ${String(renditions.length)} renditions x ${String(FIXTURE_SHAPE.segmentCount)} segments to ${outputDir}`,
);
