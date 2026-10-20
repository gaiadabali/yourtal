import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPosterLadder } from "./ffmpeg-transcode";
import { ensurePosterLadder, type PosterRecorder, type PosterStore } from "./poster-ladder";
import type { PosterAspect, PosterVariant } from "./poster-variants";

const ID = "17702653-fc8d-52f6-9ec8-76e56acef91f";
const BASE = `posters/${ID}.jpg`;
const URL_BASE = `https://yourtal.gaiada.com/media/${BASE}`;

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
    ...["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi"],
    ...["-i", `testsrc=size=${size}:rate=24:duration=2`],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", out],
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

function memoryRecorder(rows: { id: string; posterUrl: string; aspect?: PosterAspect }[]) {
  const recorded = new Map<string, PosterVariant[]>();
  const recorder: PosterRecorder = {
    pending: () =>
      Promise.resolve(
        rows
          .filter((row) => !recorded.has(row.id))
          .map((row) => ({ id: row.id, posterUrl: row.posterUrl, aspect: row.aspect ?? "16:9" })),
      ),
    record: (id, variants) => {
      recorded.set(id, [...variants]);
      return Promise.resolve();
    },
  };
  return { recorder, recorded };
}

async function cardPoster(name: string): Promise<Uint8Array> {
  const rendered = await renderPosterLadder(clip(name, "1280x720"), workDir, 0.5);
  return readFileSync(rendered.find((r) => r.longSide === 640)?.path ?? "");
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
  it("writes only the smaller size of a 640 poster and records what exists, then does nothing", async () => {
    const store = memoryStore({ [BASE]: await cardPoster("src.mp4") });
    const { recorder, recorded } = memoryRecorder([
      { id: "c1", posterUrl: URL_BASE },
      { id: "c2", posterUrl: URL_BASE },
    ]);
    const log: string[] = [];

    expect(await ensurePosterLadder(recorder, (m) => log.push(m), store)).toBe(2);
    // Never an enlargement: no 960 is made from a 640.
    expect(store.puts).toEqual([`posters/${ID}-320.jpg`]);
    const expected = [
      { url: `https://yourtal.gaiada.com/media/posters/${ID}-320.jpg`, width: 320 },
      { url: URL_BASE, width: 640 },
    ];
    expect(recorded.get("c1")).toEqual(expected);
    expect(recorded.get("c2")).toEqual(expected);
    expect(log).toHaveLength(1);

    store.puts.length = 0;
    expect(await ensurePosterLadder(recorder, (m) => log.push(m), store)).toBe(0);
    expect(store.puts).toEqual([]);
  }, 30_000);

  it("keeps a size that is already stored and records it", async () => {
    const bytes = await cardPoster("src2.mp4");
    const store = memoryStore({
      [BASE]: bytes,
      [`posters/${ID}-320.jpg`]: bytes,
      [`posters/${ID}-960.jpg`]: bytes,
    });
    const { recorder, recorded } = memoryRecorder([{ id: "c1", posterUrl: URL_BASE }]);
    await ensurePosterLadder(recorder, () => undefined, store);
    expect(store.puts).toEqual([]);
    expect(recorded.get("c1")?.map((v) => v.width)).toEqual([320, 640, 960]);
  }, 30_000);

  it("uses each campaign's own aspect for the recorded widths", async () => {
    const store = memoryStore({ [BASE]: await cardPoster("src3.mp4") });
    const { recorder, recorded } = memoryRecorder([
      { id: "tall", posterUrl: URL_BASE, aspect: "9:16" },
    ]);
    await ensurePosterLadder(recorder, () => undefined, store);
    expect(recorded.get("tall")?.map((v) => v.width)).toEqual([180, 360]);
  }, 30_000);

  it("records nothing for a missing poster or one that is not a pipeline poster", async () => {
    const store = memoryStore({ "posters/snap-app-30s.jpg": new Uint8Array([1]) });
    const { recorder, recorded } = memoryRecorder([
      { id: "gone", posterUrl: URL_BASE },
      { id: "snap", posterUrl: "https://yourtal.gaiada.com/media/posters/snap-app-30s.jpg" },
    ]);
    expect(await ensurePosterLadder(recorder, () => undefined, store)).toBe(0);
    expect(store.puts).toEqual([]);
    expect(recorded.size).toBe(0);
  });
});
