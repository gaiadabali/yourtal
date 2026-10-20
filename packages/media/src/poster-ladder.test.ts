import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPosterLadder } from "./ffmpeg-transcode";
import { ensurePosterLadder, type PosterStore } from "./poster-ladder";

const ID = "17702653-fc8d-52f6-9ec8-76e56acef91f";
const BASE = `posters/${ID}.jpg`;

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "yt-poster-ladder-"));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function clip(name: string, size: string): string {
  const out = path.join(workDir, name);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${size}:rate=24:duration=2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    out,
  ]);
  return out;
}

function dimensions(file: string): string {
  return execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file],
    { encoding: "utf8" },
  ).trim();
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

describe("renderPosterLadder", () => {
  it("renders a landscape frame at 320, 640 and 960 on the long side", async () => {
    const rendered = await renderPosterLadder(clip("wide.mp4", "1280x720"), workDir, 0.5);
    expect(rendered.map((r) => r.longSide)).toEqual([320, 640, 960]);
    expect(rendered.map((r) => dimensions(r.path))).toEqual(["320x180", "640x360", "960x540"]);
  }, 30_000);

  it("renders a portrait frame by its height", async () => {
    const rendered = await renderPosterLadder(clip("tall.mp4", "720x1280"), workDir, 0.5);
    expect(rendered.map((r) => dimensions(r.path))).toEqual(["180x320", "360x640", "540x960"]);
  }, 30_000);
});

describe("ensurePosterLadder", () => {
  it("fills in the missing sizes of an older poster, then writes nothing the second time", async () => {
    const [card] = (await renderPosterLadder(clip("src.mp4", "1280x720"), workDir, 0.5)).filter(
      (r) => r.longSide === 640,
    );
    const store = memoryStore({ [BASE]: readFileSync(card?.path ?? "") });
    const log: string[] = [];

    expect(await ensurePosterLadder([BASE, BASE], (m) => log.push(m), store)).toBe(1);
    expect(store.puts.sort()).toEqual([`posters/${ID}-320.jpg`, `posters/${ID}-960.jpg`]);
    expect(log).toHaveLength(1);

    store.puts.length = 0;
    expect(await ensurePosterLadder([BASE], (m) => log.push(m), store)).toBe(0);
    expect(store.puts).toEqual([]);
  }, 30_000);

  it("repairs only the size that is missing", async () => {
    const [card] = (await renderPosterLadder(clip("src2.mp4", "1280x720"), workDir, 0.5)).filter(
      (r) => r.longSide === 640,
    );
    const bytes = readFileSync(card?.path ?? "");
    const store = memoryStore({ [BASE]: bytes, [`posters/${ID}-320.jpg`]: bytes });
    await ensurePosterLadder([BASE], () => undefined, store);
    expect(store.puts).toEqual([`posters/${ID}-960.jpg`]);
  }, 30_000);

  it("skips a missing poster and any key that is not a pipeline poster", async () => {
    const store = memoryStore({ "posters/snap-app-30s.jpg": new Uint8Array([1]) });
    expect(
      await ensurePosterLadder([BASE, "posters/snap-app-30s.jpg"], () => undefined, store),
    ).toBe(0);
    expect(store.puts).toEqual([]);
  });
});
