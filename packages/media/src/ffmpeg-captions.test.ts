import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractCaptions, isWebVtt } from "./ffmpeg-transcode";

/** 13.9: an upload's embedded subtitle stream becomes a WebVTT track. */
let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "yt-captions-"));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function clip(withSubtitles: boolean): string {
  const srt = path.join(workDir, "cues.srt");
  writeFileSync(
    srt,
    "1\n00:00:00,500 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,500 --> 00:00:03,500\nGoodbye.\n",
  );
  const out = path.join(workDir, withSubtitles ? "with.mp4" : "without.mp4");
  execFileSync("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-y"],
    ...["-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=4"],
    ...(withSubtitles ? ["-i", srt, "-map", "0:v", "-map", "1:s", "-c:s", "mov_text"] : []),
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", out],
  ]);
  return out;
}

describe("extractCaptions", () => {
  it("turns an embedded mov_text stream into WebVTT with its cues", async () => {
    const vtt = path.join(workDir, "with.vtt");
    expect(await extractCaptions(clip(true), vtt)).toBe(true);
    const text = readFileSync(vtt, "utf8");
    expect(isWebVtt(text)).toBe(true);
    expect(text).toMatch(/(00:)?00:00\.500 --> (00:)?00:02\.000/);
    expect(text).toContain("Hello there.");
  });

  it("prefers the English track when there are several", async () => {
    const ger = path.join(workDir, "ger.srt");
    const eng = path.join(workDir, "eng.srt");
    writeFileSync(ger, "1\n00:00:00,500 --> 00:00:02,000\nHallo.\n");
    writeFileSync(eng, "1\n00:00:00,500 --> 00:00:02,000\nHello.\n");
    const out = path.join(workDir, "two.mp4");
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=3", "-i", ger, "-i", eng],
      ...["-map", "0:v", "-map", "1:s", "-map", "2:s", "-c:s", "mov_text"],
      ...["-metadata:s:s:0", "language=ger", "-metadata:s:s:1", "language=eng"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", out],
    ]);
    const vtt = path.join(workDir, "two.vtt");
    expect(await extractCaptions(out, vtt)).toBe(true);
    expect(readFileSync(vtt, "utf8")).toContain("Hello.");
  });

  it("reports no captions for an upload without a subtitle stream", async () => {
    expect(await extractCaptions(clip(false), path.join(workDir, "without.vtt"))).toBe(false);
  });

  it("does not take an empty or cue-less file for a caption track", () => {
    expect(isWebVtt("WEBVTT\n\n")).toBe(false);
    expect(isWebVtt("")).toBe(false);
  });
});
