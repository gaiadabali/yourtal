import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderHlsLadder } from "./ffmpeg-transcode";

/**
 * F66-adjacent (found 2026-09-28, 7.2.f, live-verifying a real ~3-minute
 * 24 fps upload on staging): `renderHlsLadder`'s `-g`/`-keyint_min` used to
 * be `SEGMENT_SECONDS * 30` -- a FRAME count that assumed every source is
 * 30 fps. A 24 fps source (a real download, not this repo's own 30 fps
 * `testsrc` fixtures) got the wrong keyframe interval and so the wrong
 * segment length: 180 frames / 24 fps = 7.5 s, not the promised 6 s.
 * Every existing test clip here (`transcode.test.ts`, `generate-fixture.mjs`)
 * happens to be a synthetic 30 fps `testsrc`, which is exactly why this
 * went unnoticed until a real, differently-framerated file hit the real
 * pipeline. This test is deliberately NOT 30 fps.
 */
let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "yt-ffmpeg-transcode-fixture-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function generate24fpsClip(): string {
  const clipPath = path.join(workDir, "input-24fps.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=24:duration=14",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=14",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    clipPath,
  ]);
  return clipPath;
}

/** Parses `#EXTINF:<seconds>,` lines out of a VOD playlist's raw text. */
function extinfSeconds(playlist: string): number[] {
  return [...playlist.matchAll(/#EXTINF:([\d.]+),/g)].map((match) => Number(match[1]));
}

describe("renderHlsLadder", () => {
  it("cuts 6 s segments regardless of the source's own frame rate", async () => {
    const inputPath = generate24fpsClip();
    const outputDir = path.join(workDir, "hls-out");

    await renderHlsLadder(inputPath, outputDir);

    const playlist = readFileSync(path.join(outputDir, "v1", "index.m3u8"), "utf8");
    const durations = extinfSeconds(playlist);
    expect(durations.length).toBeGreaterThan(1);

    // Every segment but the last (the tail remainder) should be ~6 s -- the
    // exact bug this test catches would report 7.5 s here instead.
    for (const duration of durations.slice(0, -1)) {
      expect(duration).toBeGreaterThan(5.5);
      expect(duration).toBeLessThan(6.5);
    }
  }, 60_000);
});
