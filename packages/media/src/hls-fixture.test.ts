import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_SHAPE, contentTypeFor, fixtureDir } from "./hls-origin";

/**
 * The committed fixture is what `scripts/generate-fixture.mjs` describes.
 *
 * The fixture is committed rather than generated at install time, so that a
 * working stack does not require ffmpeg. The cost of committing a build
 * artifact is that it can drift from the thing that built it — so the
 * parameters are asserted here, and a regenerate with different settings
 * fails until somebody updates both.
 *
 * Needs nothing running; `hls-origin.test.ts` is the one that needs MinIO.
 */

const directory = fixtureDir();

function renditionDir(rendition: string): string {
  return path.join(directory, rendition);
}

function segmentsOf(rendition: string): string[] {
  return readdirSync(renditionDir(rendition)).filter((file) => file.endsWith(".ts"));
}

describe("the committed HLS fixture", () => {
  it("has a master playlist and one directory per rung of the ladder", () => {
    expect(readdirSync(directory)).toContain("index.m3u8");

    for (const rendition of FIXTURE_SHAPE.renditionDirs) {
      expect(readdirSync(renditionDir(rendition))).toContain("index.m3u8");
      expect(segmentsOf(rendition)).toHaveLength(FIXTURE_SHAPE.segmentCount);
    }
  });

  it("advertises every rendition from the master playlist", () => {
    const master = readFileSync(path.join(directory, "index.m3u8"), "utf8");

    for (const rendition of FIXTURE_SHAPE.renditionDirs) {
      expect(master).toContain(`${rendition}/index.m3u8`);
    }
    expect([...master.matchAll(/[:,]BANDWIDTH=(\d+)/g)]).toHaveLength(
      FIXTURE_SHAPE.renditionDirs.length,
    );
  });

  /**
   * The reason this fixture exists at all. YT-0412's keyboard-seeking
   * criterion was untestable because the shared placeholder stream had a
   * 59 MB segment that aborted before the video reported a duration. A
   * single huge segment also cannot exercise segment-boundary seeking, and
   * gives per-segment delivery logging nothing to count.
   */
  it("keeps every segment small enough to load in a test", () => {
    for (const rendition of FIXTURE_SHAPE.renditionDirs) {
      for (const file of segmentsOf(rendition)) {
        const bytes = statSync(path.join(renditionDir(rendition), file)).size;
        expect(bytes).toBeGreaterThan(1_000); // a real segment, not a stub
        expect(bytes).toBeLessThan(512 * 1_024);
      }
    }
  });

  it("is a VOD playlist that declares its own duration", () => {
    // The VARIANT playlist, not the master. Only a variant carries EXTINF
    // and ENDLIST, which is what lets a player report a finite duration —
    // the master carries neither.
    const rendition = FIXTURE_SHAPE.renditionDirs[0];
    const manifest = readFileSync(path.join(renditionDir(rendition), "index.m3u8"), "utf8");

    expect(manifest.startsWith("#EXTM3U")).toBe(true);
    expect(manifest).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    // Without ENDLIST a player treats the stream as live and never reports a
    // finite duration — which is precisely the failure being fixed.
    expect(manifest).toContain("#EXT-X-ENDLIST");

    const durations = [...manifest.matchAll(/#EXTINF:([\d.]+)/g)].map((match) =>
      Number(match[1] ?? "0"),
    );
    expect(durations).toHaveLength(FIXTURE_SHAPE.segmentCount);
    expect(durations.reduce((total, seconds) => total + seconds, 0)).toBeCloseTo(
      FIXTURE_SHAPE.durationSeconds,
      3,
    );
    for (const seconds of durations) {
      expect(seconds).toBeLessThanOrEqual(FIXTURE_SHAPE.segmentSeconds);
    }
  });

  it("references exactly the segment files that exist", () => {
    for (const rendition of FIXTURE_SHAPE.renditionDirs) {
      const manifest = readFileSync(path.join(renditionDir(rendition), "index.m3u8"), "utf8");
      const referenced = manifest
        .split(/\r?\n/)
        .filter((line) => line.endsWith(".ts"))
        .sort();

      // A playlist naming a segment that is not there is a 404 mid-playback,
      // and a segment nothing references is dead weight nobody will notice.
      expect(referenced).toStrictEqual(segmentsOf(rendition).sort());
    }
  });

  it("starts every segment with an MPEG-TS sync byte", () => {
    // 0x47 every 188 bytes is what makes a .ts file a transport stream. A
    // file with the right name and the wrong bytes fails inside the demuxer,
    // where the error says nothing about the file being wrong.
    for (const rendition of FIXTURE_SHAPE.renditionDirs) {
      for (const file of segmentsOf(rendition)) {
        const head = readFileSync(path.join(renditionDir(rendition), file)).subarray(0, 188 * 3);
        expect(head[0]).toBe(0x47);
        expect(head[188]).toBe(0x47);
        expect(head[376]).toBe(0x47);
      }
    }
  });
});

describe("contentTypeFor", () => {
  it("names the types HLS requires", () => {
    expect(contentTypeFor("index.m3u8")).toBe("application/vnd.apple.mpegurl");
    expect(contentTypeFor("v0/segment0.ts")).toBe("video/mp2t");
  });

  it("refuses a file type this origin does not serve", () => {
    // Guessing `application/octet-stream` is how a segment reaches a browser
    // in a form it will not demux, reported as "the video is broken".
    expect(() => contentTypeFor("poster.jpg")).toThrow(/No content type/);
  });
});
